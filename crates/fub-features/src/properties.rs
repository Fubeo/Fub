//! Pannello delle proprietà della nota, vista globale e comandi.
//!
//! Le proprietà restano nel frontmatter sorgente. Il registro del vault ne
//! interpreta i valori; gli edit sulle chiavi esistenti sono lessicali e
//! preservano tutte le parti non toccate del YAML e del corpo.

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    Failure, InvokeMode, ParamKind, ParamSpec, Partial, PlannedEdit, Undo,
};
use fub_abi::edit::{EditRequest, TextEdit};
use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::model::{
    DateFormats, DateOrder, DocId, DocumentModel, LinkTarget, PropertyScalar, PropertyType,
    PropertyTypes, PropertyValue, Span,
};
use fub_abi::query::{QueryExpr, QueryPredicate};
use fub_abi::session::{ContextKind, ContextMask};
use fub_abi::settings::SettingValue;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, Excerpts, HostApi, IndexQuery, IndexResult, PropertyFilter, PropertySelect,
    PropertyTest, ReadApi, ViewInstance, ViewInterests, ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del componente (spazio dati/registrazione).
pub const PROPERTIES_ID: &str = "fub.properties";
/// Id della vista locale della nota.
pub const PROPERTIES_VIEW: &str = "properties";
/// Id della vista globale del vault.
pub const GLOBAL_PROPERTIES_VIEW: &str = "properties.global";
/// Imposta (o aggiunge) una chiave del frontmatter.
pub const NOTES_PROPERTY_SET: &str = "note.property.set";
/// Toglie una chiave del frontmatter.
pub const NOTES_PROPERTY_REMOVE: &str = "note.property.remove";
/// Dichiara il tipo di una proprietà per questo vault.
pub const PROPERTY_TYPE_SET: &str = "property.type.set";
/// Rinomina una chiave frontmatter in tutte le note che la portano.
pub const PROPERTY_KEY_RENAME: &str = "property.key.rename";

/// Chiavi del core: il formato di data e il registro dei tipi del vault.
const DATE_FORMAT_KEY: &str = "properties.date-format";
const TYPES_KEY: &str = "properties.types";

const SET: &str = "set";
const REMOVE: &str = "remove";
const ADD: &str = "add";
const KEY: &str = "key";
const VALUE: &str = "value";
const DOC: &str = "doc";
const NEW_KEY: &str = "new_key";
const NEW_VALUE: &str = "new_value";
const OLD_KEY: &str = "old_key";
const FILTER: &str = "filter";
const FILTER_FIELD: &str = "property_filter";
const FILTER_STATE: &str = "property.filter";
const OPEN: &str = "open";

const VIEW_TITLE: &str = "view_title";
const EMPTY_NO_NOTES: &str = "empty_no_note";
const EMPTY_NO_PROPS: &str = "empty_no_props";
const ADD_KEY_LABEL: &str = "add_key_label";
const ADD_VALUE_LABEL: &str = "add_value_label";
const ADD_SUBMIT: &str = "add_submit";
const REMOVE_LABEL: &str = "remove_label";
const E_EMPTY_KEY: &str = "e_empty_key";
const AND_NO_NOTES: &str = "e_no_note";
const E_YAML: &str = "e_yaml";
const P_SET: &str = "p_set";
const P_REMOVE: &str = "p_remove";
const P_REMOVE_MISSING: &str = "p_remove_missing";
const U_SET: &str = "u_set";
const U_REMOVE: &str = "u_remove";
const SOURCE_ONLY: &str = "source_only";
const GLOBAL_TITLE: &str = "global_title";
const GLOBAL_EMPTY: &str = "global_empty";
const GLOBAL_FILTER: &str = "global_filter";
const GLOBAL_COUNT: &str = "global_count";
const GLOBAL_VALUE_COUNT: &str = "global_value_count";
const GLOBAL_DOCS: &str = "global_docs";
const P_TYPE: &str = "p_type";
const P_RENAME: &str = "p_rename";
const U_RENAME: &str = "u_rename";
const FAILED: &str = "failed";

/// Le stringhe del pannello e dei comandi. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stiano qui.
pub fn catalog() -> Vec<StringCatalog> {
    crate::formats::speaking(vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Proprietà")
            .with(EMPTY_NO_NOTES, "Nessuna nota aperta.")
            .with(EMPTY_NO_PROPS, "Questa nota non ha proprietà.")
            .with(ADD_KEY_LABEL, "Chiave")
            .with(ADD_VALUE_LABEL, "Valore")
            .with(ADD_SUBMIT, "Aggiungi")
            .with(REMOVE_LABEL, "Rimuovi")
            .with(E_EMPTY_KEY, "La chiave è vuota.")
            .with(AND_NO_NOTES, "Nessuna nota su cui scrivere la proprietà.")
            .with(E_YAML, "Non ho potuto scrivere il frontmatter: {reason}")
            .with(P_SET, "Proprietà «{key}» in {doc}")
            .with(P_REMOVE, "Tolta «{key}» da {doc}")
            .with(P_REMOVE_MISSING, "«{key}» non c'era in {doc}")
            .with(U_SET, "Annulla: proprietà «{key}» in {doc}")
            .with(U_REMOVE, "Annulla: togli «{key}» da {doc}")
            .with(FAILED, "Non ho aggiornato le proprietà: {reason}")
            .with("note.property.set.title", "Imposta proprietà")
            .with(
                "note.property.set.desc",
                "Scrive una chiave del frontmatter della nota.",
            )
            .with("note.property.set.doc.title", "Nota")
            .with(
                "note.property.set.doc.desc",
                "La nota da modificare. Assente: quella aperta.",
            )
            .with("note.property.set.key.title", "Chiave")
            .with("note.property.set.key.desc", "Il nome della proprietà.")
            .with("note.property.set.value.title", "Valore")
            .with(
                "note.property.set.value.desc",
                "Frammento YAML (testo, numero, true/false, lista, [[wikilink]]).",
            )
            .with("note.property.remove.title", "Togli proprietà")
            .with(
                "note.property.remove.desc",
                "Toglie una chiave dal frontmatter della nota.",
            )
            .with("note.property.remove.doc.title", "Nota")
            .with(
                "note.property.remove.doc.desc",
                "La nota da modificare. Assente: quella aperta.",
            )
            .with("note.property.remove.key.title", "Chiave")
            .with(
                "note.property.remove.key.desc",
                "Il nome della proprietà da togliere.",
            )
            .with("note.property.set.expected.title", "Valore precedente")
            .with(
                "note.property.set.expected.desc",
                "JSON tagged del valore osservato, o absent.",
            )
            .with(
                "note.property.set.expected_revision.title",
                "Revisione precedente",
            )
            .with(
                "note.property.set.expected_revision.desc",
                "Revisione esatta della nota, se nota.",
            )
            .with("note.property.remove.expected.title", "Valore precedente")
            .with(
                "note.property.remove.expected.desc",
                "JSON tagged del valore osservato, o absent.",
            )
            .with(
                "note.property.remove.expected_revision.title",
                "Revisione precedente",
            )
            .with(
                "note.property.remove.expected_revision.desc",
                "Revisione esatta della nota, se nota.",
            )
            .with(SOURCE_ONLY, "«{key}»: solo sorgente ({value})")
            .with("mode.hidden", "Nascondi")
            .with("mode.structured", "Strutturato")
            .with("mode.source", "Sorgente")
            .with("source_open", "Apri il sorgente")
            .with(GLOBAL_TITLE, "Proprietà del vault")
            .with(GLOBAL_EMPTY, "Nessuna proprietà trovata.")
            .with(GLOBAL_FILTER, "Cerca chiavi o valori")
            .with(GLOBAL_COUNT, "{key} · {count} note")
            .with(GLOBAL_VALUE_COUNT, "{value} · {count} note")
            .with(GLOBAL_DOCS, "Apri {doc}")
            .with(P_TYPE, "Tipo dichiarato per «{key}»: {value}")
            .with(
                P_RENAME,
                "Rinominata «{old_key}» in «{new_key}»: {count} note",
            )
            .with(U_RENAME, "Annulla rinomina «{old_key}» in «{new_key}»")
            .with("property.type.set.title", "Dichiara tipo proprietà")
            .with(
                "property.type.set.desc",
                "Dichiara il tipo di una chiave per il vault.",
            )
            .with("property.type.set.key.title", "Chiave")
            .with("property.type.set.key.desc", "Chiave da tipizzare.")
            .with("property.type.set.type.title", "Tipo")
            .with(
                "property.type.set.type.desc",
                "text, list, number, checkbox, date, date_time o tags.",
            )
            .with("property.key.rename.title", "Rinomina proprietà nel vault")
            .with(
                "property.key.rename.desc",
                "Rinomina lessicalmente la chiave in tutte le note, con anteprima.",
            )
            .with("property.key.rename.old_key.title", "Vecchia chiave")
            .with("property.key.rename.old_key.desc", "Chiave esistente.")
            .with("property.key.rename.new_key.title", "Nuova chiave")
            .with(
                "property.key.rename.new_key.desc",
                "Chiave di destinazione.",
            ),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Properties")
            .with(EMPTY_NO_NOTES, "No note open.")
            .with(EMPTY_NO_PROPS, "This note has no properties.")
            .with(ADD_KEY_LABEL, "Key")
            .with(ADD_VALUE_LABEL, "Value")
            .with(ADD_SUBMIT, "Add")
            .with(REMOVE_LABEL, "Remove")
            .with(E_EMPTY_KEY, "The key is empty.")
            .with(AND_NO_NOTES, "No note to write the property on.")
            .with(E_YAML, "Could not write the frontmatter: {reason}")
            .with(P_SET, "Property «{key}» in {doc}")
            .with(P_REMOVE, "Removed «{key}» from {doc}")
            .with(P_REMOVE_MISSING, "«{key}» was not in {doc}")
            .with(U_SET, "Undo: property «{key}» in {doc}")
            .with(U_REMOVE, "Undo: remove «{key}» from {doc}")
            .with(FAILED, "Could not update properties: {reason}")
            .with("note.property.set.title", "Set property")
            .with(
                "note.property.set.desc",
                "Writes a frontmatter key of the note.",
            )
            .with("note.property.set.doc.title", "Note")
            .with(
                "note.property.set.doc.desc",
                "The note to change. Absent: the open one.",
            )
            .with("note.property.set.key.title", "Key")
            .with("note.property.set.key.desc", "The property name.")
            .with("note.property.set.value.title", "Value")
            .with(
                "note.property.set.value.desc",
                "YAML fragment (text, number, true/false, list, [[wikilink]]).",
            )
            .with("note.property.remove.title", "Remove property")
            .with(
                "note.property.remove.desc",
                "Removes a key from the note's frontmatter.",
            )
            .with("note.property.remove.doc.title", "Note")
            .with(
                "note.property.remove.doc.desc",
                "The note to change. Absent: the open one.",
            )
            .with("note.property.remove.key.title", "Key")
            .with(
                "note.property.remove.key.desc",
                "The property name to remove.",
            )
            .with("note.property.set.expected.title", "Previous value")
            .with(
                "note.property.set.expected.desc",
                "Tagged JSON of the observed value, or absent.",
            )
            .with(
                "note.property.set.expected_revision.title",
                "Previous revision",
            )
            .with(
                "note.property.set.expected_revision.desc",
                "Exact note revision, if known.",
            )
            .with("note.property.remove.expected.title", "Previous value")
            .with(
                "note.property.remove.expected.desc",
                "Tagged JSON of the observed value, or absent.",
            )
            .with(
                "note.property.remove.expected_revision.title",
                "Previous revision",
            )
            .with(
                "note.property.remove.expected_revision.desc",
                "Exact note revision, if known.",
            )
            .with(SOURCE_ONLY, "«{key}»: source only ({value})")
            .with("mode.hidden", "Hide")
            .with("mode.structured", "Structured")
            .with("mode.source", "Source")
            .with("source_open", "Open source")
            .with(GLOBAL_TITLE, "Vault properties")
            .with(GLOBAL_EMPTY, "No properties found.")
            .with(GLOBAL_FILTER, "Search keys or values")
            .with(GLOBAL_COUNT, "{key} · {count} notes")
            .with(GLOBAL_VALUE_COUNT, "{value} · {count} notes")
            .with(GLOBAL_DOCS, "Open {doc}")
            .with(P_TYPE, "Declared type for «{key}»: {value}")
            .with(
                P_RENAME,
                "Renamed «{old_key}» to «{new_key}» in {count} notes",
            )
            .with(U_RENAME, "Undo rename «{old_key}» to «{new_key}»")
            .with("property.type.set.title", "Declare property type")
            .with(
                "property.type.set.desc",
                "Declare a key's type for this vault.",
            )
            .with("property.type.set.key.title", "Key")
            .with("property.type.set.key.desc", "Key to type.")
            .with("property.type.set.type.title", "Type")
            .with(
                "property.type.set.type.desc",
                "text, list, number, checkbox, date, date_time or tags.",
            )
            .with("property.key.rename.title", "Rename vault property")
            .with(
                "property.key.rename.desc",
                "Rename the key lexically in all notes, with preview.",
            )
            .with("property.key.rename.old_key.title", "Old key")
            .with("property.key.rename.old_key.desc", "Existing key.")
            .with("property.key.rename.new_key.title", "New key")
            .with("property.key.rename.new_key.desc", "Destination key."),
    ])
}

/// Il pannello proprietà della nota aperta.
pub struct PropertiesView;

impl ViewProvider for PropertiesView {
    fn interests(&self, instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: if instance.view == GLOBAL_PROPERTIES_VIEW {
                ContextMask::default()
            } else {
                ContextMask(vec![ContextKind::Document])
            },
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new(
                PROPERTIES_VIEW,
                Text::key(VIEW_TITLE),
                ViewSurface::RightSidebar,
            )
            .with_icon("properties")
            .ordered(3)
            .open_by_default(),
            ViewSpec::new(
                GLOBAL_PROPERTIES_VIEW,
                Text::key(GLOBAL_TITLE),
                ViewSurface::RightSidebar,
            )
            .with_icon("vault")
            .ordered(4),
        ]
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        if instance.view == GLOBAL_PROPERTIES_VIEW {
            global_tree(host)
        } else {
            tree(host, None)
        }
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if instance.view == GLOBAL_PROPERTIES_VIEW {
            return global_action(action, host);
        }
        match action.action.0.as_str() {
            "mode" => {
                let Some(mode @ ("hidden" | "structured" | "source")) =
                    action.payload.get("mode").and_then(|v| v.as_str())
                else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state("presentation", Some(serde_json::json!(mode)))?;
                Ok(ViewUpdate::Replace {
                    root: tree(host, None)?,
                })
            }
            "source" => {
                let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                let doc = DocId::new(doc);
                let source = host.read_document(&doc)?;
                let span = frontmatter_span(&source);
                Ok(ViewUpdate::Reveal {
                    doc_id: doc.as_str().to_string(),
                    span,
                })
            }
            SET => {
                let Some(key) = action.payload.get(KEY).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                let Some(value) = yaml_from_field(&action, key) else {
                    return Ok(ViewUpdate::None);
                };
                let mut args = serde_json::json!({ KEY: key, VALUE: value });
                if let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) {
                    args[DOC] = serde_json::Value::String(doc.to_string());
                }
                command_then_tree(host, NOTES_PROPERTY_SET, args)
            }
            REMOVE => {
                let Some(key) = action.payload.get(KEY).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                let mut args = serde_json::json!({ KEY: key });
                if let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) {
                    args[DOC] = serde_json::Value::String(doc.to_string());
                }
                command_then_tree(host, NOTES_PROPERTY_REMOVE, args)
            }
            ADD => {
                let key = action.text_field(NEW_KEY).unwrap_or_default();
                let value = action.text_field(NEW_VALUE).unwrap_or_default();
                let mut args = serde_json::json!({ KEY: key, VALUE: value });
                if let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) {
                    args[DOC] = serde_json::Value::String(doc.to_string());
                }
                command_then_tree(host, NOTES_PROPERTY_SET, args)
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

fn command_then_tree(
    host: &mut dyn HostApi,
    id: &str,
    args: serde_json::Value,
) -> Result<ViewUpdate, PluginError> {
    match host.run_command(id, args) {
        Ok(_) => Ok(ViewUpdate::Replace {
            root: tree(host, None)?,
        }),
        Err(and) => Ok(ViewUpdate::Replace {
            root: tree(
                host,
                Some(Text::message(
                    FAILED,
                    vec![Arg::text("reason", and.to_string())],
                )),
            )?,
        }),
    }
}

fn yaml_from_field(action: &UiAction, key: &str) -> Option<String> {
    if let Some(b) = action.bool_field(key) {
        return Some(if b { "true" } else { "false" }.into());
    }
    if let Some(n) = action.number_field(key) {
        return Some(yaml_number(n));
    }
    action.text_field(key).map(str::to_string)
}

fn yaml_number(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < (i64::MAX as f64) {
        format!("{}", n as i64)
    } else {
        n.to_string()
    }
}

fn tree(host: &dyn ReadApi, warning: Option<Text>) -> Result<UiNode, PluginError> {
    let mode = host.view_state("presentation")?;
    let mode = mode
        .as_ref()
        .and_then(|v| v.as_str())
        .unwrap_or("structured");
    let mut children = vec![UiNode::new(UiKind::Stack {
        dir: fub_abi::ui::Axis::Row,
        gap: 1,
        children: ["hidden", "structured", "source"]
            .into_iter()
            .map(|name| {
                UiNode::button(
                    Text::key(format!("mode.{name}")),
                    if mode == name {
                        Intent::Primary
                    } else {
                        Intent::Neutral
                    },
                    ActionRef::with("mode", serde_json::json!({ "mode": name })),
                )
            })
            .collect(),
    })];
    if let Some(warning) = warning {
        children.push(UiNode::failed(warning, None));
    }
    if mode == "hidden" {
        return Ok(UiNode::column(1, children));
    }
    let Some(doc) = host.active_context().and_then(|c| c.doc) else {
        children.push(UiNode::empty_state(Text::key(EMPTY_NO_NOTES)));
        return Ok(UiNode::column(1, children));
    };
    if mode == "source" {
        let source = host.read_document(&doc)?;
        let span = frontmatter_span(&source);
        children.push(UiNode::new(UiKind::Text {
            content: Text::from(source[span.start..span.end].to_string()),
        }));
        children.push(source_button(&doc));
        return Ok(UiNode::column(1, children));
    }
    let model = host.read_model(&doc)?;
    let props = model
        .frontmatter
        .properties_with_types(&date_formats(host), &property_types(host));
    if props.is_empty() {
        children.push(UiNode::empty_state(Text::key(EMPTY_NO_PROPS)));
    } else {
        children.extend(
            props
                .iter()
                .map(|(k, v)| row(&doc, k, v, model.frontmatter.get(k))),
        );
    }
    children.push(add_form(&doc));
    Ok(UiNode::column(1, children))
}

fn frontmatter_span(source: &str) -> Span {
    let start = source_start(source);
    if let Some((_, closing)) = frontmatter_bounds(source, start) {
        let end = source[closing..]
            .find('\n')
            .map_or(source.len(), |n| closing + n + 1);
        Span::new(start, end)
    } else {
        Span::new(start, start)
    }
}

fn source_button(doc: &DocId) -> UiNode {
    UiNode::button(
        Text::key("source_open"),
        Intent::Neutral,
        ActionRef::with("source", serde_json::json!({ DOC: doc.as_str() })),
    )
}

fn property_types(host: &dyn ReadApi) -> PropertyTypes {
    match host.setting(TYPES_KEY) {
        Ok(SettingValue::Text(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
        _ => PropertyTypes::default(),
    }
}
fn global_action(action: UiAction, host: &mut dyn HostApi) -> Result<ViewUpdate, PluginError> {
    match action.action.0.as_str() {
        FILTER => {
            let value = action.text_field(FILTER_FIELD).unwrap_or_default();
            host.set_view_state(
                FILTER_STATE,
                (!value.is_empty()).then(|| serde_json::json!(value)),
            )?;
            Ok(ViewUpdate::Replace {
                root: global_tree(host)?,
            })
        }
        OPEN => {
            let Some(doc) = action.payload.get(DOC).and_then(|v| v.as_str()) else {
                return Ok(ViewUpdate::None);
            };
            Ok(ViewUpdate::Navigate {
                doc_id: doc.to_string(),
            })
        }
        _ => Ok(ViewUpdate::None),
    }
}

fn property_display(value: &PropertyValue) -> String {
    match value {
        PropertyValue::Text(text) => text.clone(),
        PropertyValue::Number(number) => number.to_string(),
        PropertyValue::Bool(value) => value.to_string(),
        PropertyValue::Date(date) => show_date(date),
        PropertyValue::Link(link) => show_link(link),
        PropertyValue::List(items) => show_list(items),
        PropertyValue::Empty => "null".to_string(),
        PropertyValue::Unknown(value) => value.to_string(),
    }
}

/// All rows and facets come from the indexed data channel; no vault file walk.
fn global_tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let filter = host
        .view_state(FILTER_STATE)?
        .and_then(|v| v.as_str().map(str::to_lowercase))
        .unwrap_or_default();
    let mut by_key: std::collections::BTreeMap<String, Vec<(DocId, PropertyValue)>> =
        std::collections::BTreeMap::new();
    let documents = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::all(),
            sort: None,
            select: PropertySelect::All,
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?;
    for doc in documents.items {
        for property in doc.properties {
            by_key
                .entry(property.key)
                .or_default()
                .push((doc.doc.clone(), property.value));
        }
    }
    let mut children = vec![UiNode::new(UiKind::TextInput {
        field: FILTER_FIELD.to_string(),
        label: Some(Text::key(GLOBAL_FILTER)),
        value: filter.clone(),
        placeholder: None,
        action: Some(ActionRef::new(FILTER)),
    })];
    for (key, docs) in by_key {
        let key_matches = key.to_lowercase().contains(&filter);
        let matching_docs: Vec<_> = docs
            .iter()
            .filter(|(_, value)| {
                key_matches || property_display(value).to_lowercase().contains(&filter)
            })
            .collect();
        if matching_docs.is_empty() {
            continue;
        }
        let facets = match host.query_index(IndexQuery::PropertyValues {
            key: key.clone(),
            matching: QueryExpr::all(),
            page: None,
        })? {
            IndexResult::PropertyValues(page) => page.items,
            other => {
                return Err(PluginError::Internal(
                    format!("property facets: {}", other.kind_name()).into(),
                ))
            }
        };
        let mut entries = vec![UiNode::new(UiKind::Text {
            content: Text::message(
                GLOBAL_COUNT,
                vec![
                    Arg::text(KEY, &key),
                    Arg::text("count", docs.len().to_string()),
                ],
            ),
        })];
        entries.extend(facets.into_iter().filter_map(|facet| {
            let value = property_display(&facet.value);
            (key_matches || value.to_lowercase().contains(&filter)).then(|| {
                UiNode::new(UiKind::Text {
                    content: Text::message(
                        GLOBAL_VALUE_COUNT,
                        vec![
                            Arg::text(VALUE, value),
                            Arg::text("count", facet.count.to_string()),
                        ],
                    ),
                })
            })
        }));
        entries.push(UiNode::list(
            matching_docs
                .into_iter()
                .map(|(doc, _)| {
                    UiNode::list_item(
                        Text::message(GLOBAL_DOCS, vec![Arg::text(DOC, doc.as_str())]),
                        None,
                        Some(ActionRef::with(
                            OPEN,
                            serde_json::json!({ DOC: doc.as_str() }),
                        )),
                    )
                    .with_key(doc.as_str())
                })
                .collect(),
        ));
        children.push(UiNode::keyed(
            key,
            UiKind::Stack {
                dir: fub_abi::ui::Axis::Column,
                gap: 1,
                children: entries,
            },
        ));
    }
    if children.len() == 1 {
        children.push(UiNode::empty_state(Text::key(GLOBAL_EMPTY)));
    }
    Ok(UiNode::column(1, children))
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

fn row(doc: &DocId, key: &str, value: &PropertyValue, raw: Option<&serde_json::Value>) -> UiNode {
    let payload = serde_json::json!({ KEY: key, DOC: doc.as_str() });
    let source_only = matches!(value, PropertyValue::Unknown(_) | PropertyValue::Empty)
        || matches!(value, PropertyValue::List(items) if items.iter().any(|v|
            matches!(v, PropertyScalar::Unknown(_) | PropertyScalar::Date(fub_abi::model::PropertyDate { time: Some(_), .. }))
        ));
    let field = if source_only {
        UiNode::new(UiKind::Text {
            content: Text::message(
                SOURCE_ONLY,
                vec![
                    Arg::text(KEY, key),
                    Arg::text(
                        VALUE,
                        raw.map_or_else(|| "null".to_string(), |v| v.to_string()),
                    ),
                ],
            ),
        })
    } else {
        widget(key, value, payload.clone(), raw)
    };
    let mut controls = vec![field];
    if source_only {
        controls.push(source_button(doc));
    } else {
        controls.push(UiNode::button(
            Text::key(REMOVE_LABEL),
            Intent::Danger,
            ActionRef::with(REMOVE, payload),
        ));
    }
    UiNode::keyed(
        key,
        UiKind::Stack {
            dir: fub_abi::ui::Axis::Row,
            gap: 1,
            children: controls,
        },
    )
}

fn widget(
    key: &str,
    value: &PropertyValue,
    payload: serde_json::Value,
    raw: Option<&serde_json::Value>,
) -> UiNode {
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
        PropertyValue::Date(d) if d.time.is_none() => UiNode::new(UiKind::DatePicker {
            field: key.to_string(),
            label,
            value: Some(format!("{:04}-{:02}-{:02}", d.year, d.month, d.day)),
            action,
        }),
        PropertyValue::Date(_) => UiNode::new(UiKind::TextInput {
            field: key.to_string(),
            label,
            value: raw
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string(),
            placeholder: None,
            action,
        }),
        PropertyValue::Link(t) => UiNode::new(UiKind::TextInput {
            field: key.to_string(),
            label,
            value: show_link(t),
            placeholder: None,
            action,
        }),
        PropertyValue::List(items) => UiNode::new(UiKind::TextInput {
            field: key.to_string(),
            label,
            value: show_list(items),
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

fn show_link(t: &LinkTarget) -> String {
    match t {
        LinkTarget::Wiki { .. } => match t.wiki_inner() {
            Some(inner) => format!("[[{inner}]]"),
            None => String::new(),
        },
        LinkTarget::Url(s) | LinkTarget::Path(s) => s.clone(),
    }
}
fn show_date(date: &fub_abi::model::PropertyDate) -> String {
    let day = format!("{:04}-{:02}-{:02}", date.year, date.month, date.day);
    let Some(time) = date.time else { return day };
    let zone = match time.offset_minutes {
        None => String::new(),
        Some(0) => "Z".to_string(),
        Some(minutes) => {
            let sign = if minutes < 0 { '-' } else { '+' };
            let minutes = i32::from(minutes).abs();
            format!("{sign}{:02}:{:02}", minutes / 60, minutes % 60)
        }
    };
    format!(
        "{day}T{:02}:{:02}:{:02}{zone}",
        time.hour, time.minute, time.second
    )
}

fn show_list(items: &[fub_abi::model::PropertyScalar]) -> String {
    let vals: Vec<serde_json::Value> = items.iter().map(scalar_to_json).collect();
    match serde_yaml_ng::to_string(&vals) {
        Ok(s) => s.trim().to_string(),
        Err(_) => String::new(),
    }
}

fn scalar_to_json(s: &fub_abi::model::PropertyScalar) -> serde_json::Value {
    use fub_abi::model::PropertyScalar;
    match s {
        PropertyScalar::Empty => serde_json::Value::Null,
        PropertyScalar::Text(t) => serde_json::Value::String(t.clone()),
        PropertyScalar::Number(n) => serde_json::Number::from_f64(*n)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::String(n.to_string())),
        PropertyScalar::Bool(b) => serde_json::Value::Bool(*b),
        PropertyScalar::Date(d) => serde_json::Value::String(show_date(d)),
        PropertyScalar::Link(t) => serde_json::Value::String(show_link(t)),
        PropertyScalar::Unknown(v) => v.clone(),
    }
}

fn add_form(doc: &DocId) -> UiNode {
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

/// I comandi delle proprietà della nota e del vault.
pub struct PropertiesCommands;

impl CommandProvider for PropertiesCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            command(NOTES_PROPERTY_SET)
                .with_param(parameter(NOTES_PROPERTY_SET, DOC, ParamKind::Document))
                .with_param(parameter(NOTES_PROPERTY_SET, KEY, ParamKind::Text).required())
                .with_param(parameter(NOTES_PROPERTY_SET, VALUE, ParamKind::Text).required())
                .with_param(parameter(NOTES_PROPERTY_SET, "expected", ParamKind::Text))
                .with_param(parameter(
                    NOTES_PROPERTY_SET,
                    "expected_revision",
                    ParamKind::Text,
                ))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_PROPERTY_REMOVE)
                .with_param(parameter(NOTES_PROPERTY_REMOVE, DOC, ParamKind::Document))
                .with_param(parameter(NOTES_PROPERTY_REMOVE, KEY, ParamKind::Text).required())
                .with_param(parameter(
                    NOTES_PROPERTY_REMOVE,
                    "expected",
                    ParamKind::Text,
                ))
                .with_param(parameter(
                    NOTES_PROPERTY_REMOVE,
                    "expected_revision",
                    ParamKind::Text,
                ))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(PROPERTY_TYPE_SET)
                .with_param(parameter(PROPERTY_TYPE_SET, KEY, ParamKind::Text).required())
                .with_param(parameter(PROPERTY_TYPE_SET, "type", ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Settings).irreversible()),
            command(PROPERTY_KEY_RENAME)
                .with_param(parameter(PROPERTY_KEY_RENAME, OLD_KEY, ParamKind::Text).required())
                .with_param(parameter(PROPERTY_KEY_RENAME, NEW_KEY, ParamKind::Text).required())
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
            NOTES_PROPERTY_SET | NOTES_PROPERTY_REMOVE => {
                let expected = expected_property(&args)?;
                let expected_revision = args
                    .get("expected_revision")
                    .and_then(serde_json::Value::as_str);
                if command == NOTES_PROPERTY_SET {
                    set(Args::new(&args), expected, expected_revision, mode, host)
                } else {
                    remove(Args::new(&args), expected, expected_revision, mode, host)
                }
            }
            PROPERTY_TYPE_SET => set_property_type(Args::new(&args), mode, host),
            PROPERTY_KEY_RENAME => rename_property_key(Args::new(&args), mode, host),
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

/// Il documento su cui scrivere, e solo se il suo formato ha un frontmatter:
/// scriverne uno davanti a un `.base` o a un canvas lo corrompe.
fn doc_from(args: Args<'_>, host: &dyn HostApi) -> Result<DocId, PluginError> {
    let doc = args
        .document(DOC)
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_NOTES)))?;
    crate::formats::require(host, &doc, fub_abi::options::syntax::FRONTMATTER)?;
    Ok(doc)
}

fn key_from(args: Args<'_>) -> Result<String, PluginError> {
    let key = args.text(KEY).unwrap_or("").trim();
    if key.is_empty() {
        Err(PluginError::BadArgs(Text::key(E_EMPTY_KEY)))
    } else {
        Ok(key.to_string())
    }
}

/// Optional for existing callers; Base supplies the tagged observed value.
/// `absent` and present YAML null (`PropertyValue::Empty`) never collapse.
fn expected_property(
    args: &serde_json::Value,
) -> Result<Option<Option<PropertyValue>>, PluginError> {
    let Some(raw) = args.get("expected") else {
        return Ok(None);
    };
    let source = raw.as_str().ok_or_else(|| {
        PluginError::BadArgs(Text::from("expected deve essere JSON tagged testuale"))
    })?;
    let expected: serde_json::Value = serde_json::from_str(source)
        .map_err(|error| PluginError::BadArgs(Text::from(format!("expected JSON: {error}"))))?;
    let object = expected
        .as_object()
        .ok_or_else(|| PluginError::BadArgs(Text::from("expected deve essere oggetto tagged")))?;
    match object.get("kind").and_then(serde_json::Value::as_str) {
        Some("absent") if object.len() == 1 => Ok(Some(None)),
        Some("value") if object.len() == 2 => {
            let value = object
                .get("value")
                .ok_or_else(|| PluginError::BadArgs(Text::from("expected.value mancante")))?;
            let value =
                serde_json::from_value::<PropertyValue>(value.clone()).map_err(|error| {
                    PluginError::BadArgs(Text::from(format!("expected.value: {error}")))
                })?;
            Ok(Some(Some(value)))
        }
        _ => Err(PluginError::BadArgs(Text::from(
            "expected deve essere absent o value",
        ))),
    }
}

fn check_expected(
    model: &DocumentModel,
    host: &dyn HostApi,
    key: &str,
    expected: &Option<Option<PropertyValue>>,
) -> Result<(), PluginError> {
    if let Some(expected) = expected {
        let current =
            model
                .frontmatter
                .property_with_types(key, &date_formats(host), &property_types(host));
        if &current != expected {
            return Err(PluginError::Conflict(Text::from(format!(
                "la proprietà {key} è cambiata"
            ))));
        }
    }
    Ok(())
}

fn set(
    args: Args<'_>,
    expected: Option<Option<PropertyValue>>,
    expected_revision: Option<&str>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_from(args, host)?;
    let key = key_from(args)?;
    let grezzo = args.text(VALUE).unwrap_or("");
    let mut value = parse_yaml_value(grezzo);
    let declared = property_types(host).resolve(&key);
    if declared == Some(PropertyType::Text) && !value.is_string() {
        value = serde_json::Value::String(grezzo.to_string());
    }
    let mut candidate = fub_abi::model::Frontmatter::default();
    candidate.0.insert(key.clone(), value.clone());
    if declared.is_some()
        && matches!(
            candidate.property_with_types(&key, &date_formats(host), &property_types(host)),
            Some(PropertyValue::Unknown(_))
        )
    {
        return Err(PluginError::BadArgs(
            format!("valore incompatibile con il tipo dichiarato per {key}").into(),
        ));
    }
    rewrite(
        &key,
        &expected,
        expected_revision,
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
        |map| {
            map.insert(key.clone(), value.clone());
            Ok(())
        },
    )
}

fn remove(
    args: Args<'_>,
    expected: Option<Option<PropertyValue>>,
    expected_revision: Option<&str>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_from(args, host)?;
    let key = key_from(args)?;
    if let Some(expected_revision) = expected_revision {
        if host.document_revision(&doc)?.0 != expected_revision {
            return Err(PluginError::Conflict(Text::from(
                "la revisione della nota è cambiata",
            )));
        }
    }
    let model = host.read_model(&doc)?;
    check_expected(&model, host, &key, &expected)?;
    if model.frontmatter.get(&key).is_none() {
        return Ok(CommandOutcome::notify(Text::message(
            P_REMOVE_MISSING,
            vec![Arg::text(KEY, &key), Arg::text(DOC, doc.as_str())],
        )));
    }
    rewrite(
        &key,
        &expected,
        expected_revision,
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
        |map| {
            map.remove(&key);
            Ok(())
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn rewrite(
    key: &str,
    expected: &Option<Option<PropertyValue>>,
    expected_revision: Option<&str>,
    host: &mut dyn HostApi,
    doc: &DocId,
    mode: InvokeMode,
    summary: Text,
    undo_label: Text,
    mut mutate: impl FnMut(&mut serde_json::Map<String, serde_json::Value>) -> Result<(), PluginError>,
) -> Result<CommandOutcome, PluginError> {
    // Snapshot the revision *before* reading. A concurrent change after it
    // fails the EditRequest CAS instead of blessing stale model/source bytes.
    let revision = host.document_revision(doc)?;
    if expected_revision.is_some_and(|expected| revision.0 != expected) {
        return Err(PluginError::Conflict(Text::from(
            "la revisione della nota è cambiata",
        )));
    }
    let source = host.read_document(doc)?;
    let model = host.read_model(doc)?;
    check_expected(&model, host, key, expected)?;
    let mut map = model.frontmatter.0.clone();
    mutate(&mut map)?;
    let edit = edit_property_frontmatter(&source, &model, key, map.get(key))?;
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
fn set_property_type(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let key = key_from(args)?;
    let raw_type = args.text("type").unwrap_or("");
    let kind: PropertyType = serde_json::from_value(serde_json::json!(raw_type)).map_err(|_| {
        PluginError::BadArgs(format!("tipo proprietà non riconosciuto: {raw_type}").into())
    })?;
    let mut types = writable_property_types(host)?;
    types.types.insert(key.clone(), kind);
    let value = serde_json::to_string(&types)
        .map_err(|e| PluginError::Internal(format!("{TYPES_KEY}: {e}").into()))?;
    let summary = Text::message(
        P_TYPE,
        vec![Arg::text(KEY, key), Arg::text(VALUE, raw_type)],
    );
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan {
                summary,
                ..CommandPlan::default()
            })),
        );
    }
    host.set_setting(TYPES_KEY, SettingValue::Text(value))?;
    Ok(CommandOutcome::notify(summary))
}
fn writable_property_types(host: &dyn HostApi) -> Result<PropertyTypes, PluginError> {
    // Render may use the default interpretation on corrupt/future metadata;
    // mutation must not erase that authoritative raw setting.
    match host.setting(TYPES_KEY)? {
        SettingValue::Text(raw) if raw.trim().is_empty() => Ok(PropertyTypes::default()),
        SettingValue::Text(raw) => serde_json::from_str::<PropertyTypes>(&raw)
            .map_err(|e| PluginError::BadArgs(format!("{TYPES_KEY}: {e}").into())),
        _ => Err(PluginError::BadArgs(
            format!("{TYPES_KEY}: expected text").into(),
        )),
    }
}

fn rename_property_key(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let old = args.text(OLD_KEY).unwrap_or("").trim();
    let new = args.text(NEW_KEY).unwrap_or("").trim();
    if old.is_empty() || new.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_KEY)));
    }
    if old == new {
        return Err(PluginError::BadArgs(
            "la nuova chiave deve essere diversa".into(),
        ));
    }
    encoded_key(new)?;
    let mut types = writable_property_types(host)?;
    let copy_type = match types.resolve(old) {
        Some(kind) => {
            if types.resolve(new).is_some_and(|existing| existing != kind) {
                return Err(PluginError::Conflict(
                    format!("tipo incompatibile per «{new}»").into(),
                ));
            }
            if types.types.get(new) == Some(&kind) {
                None
            } else {
                types.types.insert(new.to_string(), kind);
                Some(
                    serde_json::to_string(&types)
                        .map_err(|e| PluginError::Internal(format!("{TYPES_KEY}: {e}").into()))?,
                )
            }
        }
        None => None,
    };
    let docs = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Property {
                filter: PropertyFilter {
                    key: old.to_string(),
                    test: PropertyTest::Exists,
                },
            }),
            sort: None,
            select: PropertySelect::None,
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?
        .items;
    let attempted = docs.len();
    let mut plans = Vec::with_capacity(attempted);
    let mut failures = Vec::new();
    // Capture all revisions before applying any edit. A change during the
    // operation fails the per-document CAS instead of overwriting newer text.
    for entry in docs {
        let doc = entry.doc;
        let prepared = (|| -> Result<Option<PlannedEdit>, PluginError> {
            crate::formats::require(host, &doc, fub_abi::options::syntax::FRONTMATTER)?;
            let revision = host.document_revision(&doc)?;
            let source = host.read_document(&doc)?;
            let model = host.read_model(&doc)?;
            if model.frontmatter.get(old).is_none() {
                return Ok(None); // already renamed: safe to rerun
            }
            if model.frontmatter.get(new).is_some() {
                return Err(PluginError::Conflict(
                    format!("{doc}: destination «{new}» already exists").into(),
                ));
            }
            let edit = edit_property_key(&source, old, new)?;
            Ok(Some(PlannedEdit::new(
                doc.clone(),
                EditRequest::new(revision, vec![edit]),
            )))
        })();
        match prepared {
            Ok(Some(edit)) => plans.push(edit),
            Ok(None) => {}
            Err(error) => failures.push(Failure::of(doc, error)),
        }
    }
    let summary = |count: usize| {
        Text::message(
            P_RENAME,
            vec![
                Arg::text(OLD_KEY, old),
                Arg::text(NEW_KEY, new),
                Arg::text("count", count.to_string()),
            ],
        )
    };
    if mode.is_dry_run() {
        let planned = plans.len();
        return Ok(CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary(planned),
                plans,
            )))
            .partially(Partial::of(attempted, planned, failures)));
    }
    if let Some(raw) = copy_type {
        host.set_setting(TYPES_KEY, SettingValue::Text(raw))?;
    }
    let mut inverses = Vec::new();
    for planned in plans {
        match host.apply_edit(&planned.doc, planned.edit) {
            Ok(report) => inverses.push(PlannedEdit::new(planned.doc, report.inverse())),
            Err(error) => failures.push(Failure::of(planned.doc, error)),
        }
    }
    let changed = inverses.len();
    let mut outcome = CommandOutcome::notify(summary(changed))
        .partially(Partial::of(attempted, changed, failures));
    if !inverses.is_empty() {
        inverses.reverse();
        outcome = outcome.undoable(Undo::of_edits(
            Text::message(
                U_RENAME,
                vec![Arg::text(OLD_KEY, old), Arg::text(NEW_KEY, new)],
            ),
            inverses,
        ));
    }
    Ok(outcome)
}

/// Parsa un frammento YAML in JSON. Se non è YAML, resta una stringa.
pub(crate) fn parse_yaml_value(s: &str) -> serde_json::Value {
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

#[derive(Clone, Copy)]
struct SourceLine {
    start: usize,
    content_end: usize,
}

fn yaml_error(reason: impl ToString) -> PluginError {
    PluginError::BadArgs(Text::message(
        E_YAML,
        vec![Arg::text("reason", reason.to_string())],
    ))
}

fn frontmatter_bounds(source: &str, start: usize) -> Option<(usize, usize)> {
    let opening_end = source[start..]
        .find('\n')
        .map(|offset| start + offset + 1)?;
    if source[start..opening_end]
        .trim_end_matches(['\r', '\n'])
        .trim()
        != "---"
    {
        return None;
    }
    let mut line_start = opening_end;
    while line_start <= source.len() {
        let line_end = source[line_start..]
            .find('\n')
            .map(|offset| line_start + offset)
            .unwrap_or(source.len());
        let marker = source[line_start..line_end].trim_end_matches('\r').trim();
        if marker == "---" || marker == "..." {
            return Some((opening_end, line_start));
        }
        if line_end == source.len() {
            break;
        }
        line_start = line_end + 1;
    }
    None
}

fn source_lines(source: &str, from: usize, to: usize) -> Vec<SourceLine> {
    let mut lines = Vec::new();
    let mut start = from;
    while start < to {
        let newline = source[start..to].find('\n').map(|offset| start + offset);
        let end = newline.map_or(to, |at| at + 1);
        let mut content_end = newline.unwrap_or(to);
        if content_end > start && source.as_bytes()[content_end - 1] == b'\r' {
            content_end -= 1;
        }
        lines.push(SourceLine { start, content_end });
        start = end;
    }
    lines
}

fn mapping_colon(line: &str) -> Option<usize> {
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    let mut flow = 0_u32;
    for (offset, character) in line.char_indices() {
        if double {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                double = false;
            }
            continue;
        }
        if single {
            if character == '\'' {
                single = false;
            }
            continue;
        }
        match character {
            '"' => double = true,
            '\'' => single = true,
            '[' | '{' => flow = flow.saturating_add(1),
            ']' | '}' => flow = flow.saturating_sub(1),
            ':' if flow == 0 => {
                let after = &line[offset + 1..];
                if after.is_empty() || after.starts_with(char::is_whitespace) {
                    return Some(offset);
                }
            }
            _ => {}
        }
    }
    None
}

fn decoded_key(token: &str) -> Option<String> {
    let token = token.trim();
    if token.is_empty() {
        return None;
    }
    if token.starts_with('"') && token.ends_with('"') {
        return serde_json::from_str(token).ok();
    }
    if token.starts_with('\'') && token.ends_with('\'') && token.len() >= 2 {
        return Some(token[1..token.len() - 1].replace("''", "'"));
    }
    Some(token.to_string())
}

fn inline_comment(value: &str) -> Option<&str> {
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    for (offset, character) in value.char_indices() {
        if double {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                double = false;
            }
            continue;
        }
        if single {
            if character == '\'' {
                single = false;
            }
            continue;
        }
        match character {
            '"' => double = true,
            '\'' => single = true,
            '#' if value[..offset]
                .chars()
                .last()
                .is_none_or(char::is_whitespace) =>
            {
                return Some(&value[offset..]);
            }
            _ => {}
        }
    }
    None
}

fn encoded_key(key: &str) -> Result<String, PluginError> {
    if key.chars().enumerate().all(|(index, character)| {
        character == '_'
            || character == '-'
            || character == '.'
            || character.is_alphanumeric() && (index > 0 || !character.is_ascii_digit())
    }) && !matches!(
        key.to_ascii_lowercase().as_str(),
        "null" | "true" | "false" | "~"
    ) {
        Ok(key.to_string())
    } else {
        serde_json::to_string(key).map_err(yaml_error)
    }
}
/// Rename only the top-level key token: values, nested YAML, whitespace,
/// quoting of unrelated entries, comments and body bytes remain untouched.
fn edit_property_key(source: &str, old: &str, new: &str) -> Result<TextEdit, PluginError> {
    let (inner, closing) = frontmatter_bounds(source, source_start(source))
        .ok_or_else(|| yaml_error("delimitatori frontmatter non validi"))?;
    let mut found = None;
    for line in source_lines(source, inner, closing) {
        let text = &source[line.start..line.content_end];
        if text.is_empty() || text.starts_with([' ', '\t']) || text.trim_start().starts_with('#') {
            continue;
        }
        let Some(colon) = mapping_colon(text) else {
            continue;
        };
        let Some(key) = decoded_key(&text[..colon]) else {
            continue;
        };
        if key == new {
            return Err(PluginError::Conflict(
                format!("la chiave «{new}» esiste già").into(),
            ));
        }
        if key == old {
            if found.is_some() {
                return Err(yaml_error(format!(
                    "proprietà «{old}» dichiarata più volte"
                )));
            }
            let token = text[..colon].trim_end();
            let replacement = if token.starts_with('"') && token.ends_with('"') {
                serde_json::to_string(new).map_err(yaml_error)?
            } else if token.starts_with('\'') && token.ends_with('\'') {
                format!("'{}'", new.replace('\'', "''"))
            } else {
                encoded_key(new)?
            };
            found = Some(TextEdit::replace(
                Span::new(line.start, line.start + token.len()),
                replacement,
            ));
        }
    }
    found.ok_or_else(|| yaml_error(format!("chiave «{old}» non rappresentabile nel sorgente")))
}

fn encoded_value(value: &serde_json::Value) -> Result<String, PluginError> {
    serde_json::to_string(value).map_err(yaml_error)
}

/// Produces one lexical top-level property edit. Existing key spelling, order,
/// unrelated comments, quoting, and every body byte remain untouched.
fn edit_property_frontmatter(
    source: &str,
    model: &DocumentModel,
    key: &str,
    value: Option<&serde_json::Value>,
) -> Result<TextEdit, PluginError> {
    if !model.frontmatter_present {
        let mut map = model.frontmatter.0.clone();
        match value {
            Some(value) => {
                map.insert(key.to_string(), value.clone());
            }
            None => {
                map.remove(key);
            }
        }
        return edit_frontmatter(source, model, &map);
    }

    let start = source_start(source);
    let (inner_start, closing_start) = frontmatter_bounds(source, start)
        .ok_or_else(|| yaml_error("delimitatori frontmatter non validi"))?;
    let lines = source_lines(source, inner_start, closing_start);
    let mut entries: Vec<(usize, usize, String)> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let text = &source[line.start..line.content_end];
        if text.is_empty() || text.starts_with([' ', '\t']) || text.trim_start().starts_with('#') {
            continue;
        }
        let Some(colon) = mapping_colon(text) else {
            continue;
        };
        let Some(found) = decoded_key(&text[..colon]) else {
            continue;
        };
        entries.push((index, line.start + colon, found));
    }

    let matching_entries: Vec<_> = entries
        .iter()
        .enumerate()
        .filter(|(_, (_, _, found))| found == key)
        .collect();
    if matching_entries.len() > 1 {
        return Err(yaml_error(format!(
            "proprietà «{key}» dichiarata più volte"
        )));
    }
    if let Some((entry_position, (line_index, colon, _))) = matching_entries.first().copied() {
        let next_line = entries
            .get(entry_position + 1)
            .map_or(lines.len(), |(line, _, _)| *line);
        let line = lines[*line_index];
        let mut last_content_end = line.content_end;
        for candidate in &lines[*line_index + 1..next_line] {
            let text = source[candidate.start..candidate.content_end].trim();
            if !text.is_empty() && !text.starts_with('#') {
                last_content_end = candidate.content_end;
            }
        }
        return match value {
            Some(value) => {
                let value = encoded_value(value)?;
                let comment = inline_comment(&source[*colon + 1..line.content_end]);
                let replacement = comment.map_or_else(
                    || format!(" {value}"),
                    |comment| format!(" {value} {comment}"),
                );
                Ok(TextEdit::replace(
                    Span::new(*colon + 1, last_content_end),
                    replacement,
                ))
            }
            None => {
                let removal_end = source[last_content_end..closing_start]
                    .find('\n')
                    .map_or(last_content_end, |offset| last_content_end + offset + 1);
                Ok(TextEdit::replace(
                    Span::new(line.start, removal_end),
                    String::new(),
                ))
            }
        };
    }
    if model.frontmatter.get(key).is_some() {
        return Err(yaml_error(format!(
            "proprietà «{key}» non rappresentabile come chiave YAML semplice"
        )));
    }

    let Some(value) = value else {
        return Err(yaml_error(format!(
            "proprietà «{key}» non trovata nella sorgente"
        )));
    };
    let eol = if source[inner_start..closing_start].contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let prefix = if closing_start > inner_start && !source[..closing_start].ends_with(['\n', '\r'])
    {
        eol
    } else {
        ""
    };
    Ok(TextEdit::insert(
        closing_start,
        format!(
            "{prefix}{}: {}{eol}",
            encoded_key(key)?,
            encoded_value(value)?
        ),
    ))
}

/// L'edit che sostituisce (o inserisce) il blocco frontmatter. Il corpo dopo
/// lo span resta intatto.
pub(crate) fn edit_frontmatter(
    source: &str,
    model: &DocumentModel,
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<TextEdit, PluginError> {
    let start = source_start(source);
    let block = serialize_block(map)?;
    if model.frontmatter_present {
        let end = end_frontmatter(source, model);
        Ok(TextEdit::replace(Span::new(start, end), block))
    } else {
        let mut text = block;
        if start < source.len() {
            if !text.ends_with('\n') {
                text.push('\n');
            }
            text.push('\n');
        }
        Ok(TextEdit::insert(start, text))
    }
}

pub(crate) fn source_start(source: &str) -> usize {
    if source.starts_with('\u{FEFF}') {
        '\u{FEFF}'.len_utf8()
    } else {
        0
    }
}

/// Come `fine_del_frontmatter` in `fub-format-markdown`: fine = inizio riga del
/// primo blocco del body (attraverso soli space/tab), o `source.len()` se il
/// body è vuoto.
fn end_frontmatter(source: &str, model: &DocumentModel) -> usize {
    match model.body.first() {
        Some(first) => {
            let content = first.span().start;
            let content = content.min(source.len());
            let row = source[..content]
                .rfind(['\n', '\r'])
                .map(|the| the + 1)
                .unwrap_or(0);
            if source
                .get(row..content)
                .is_some_and(|s| s.chars().all(|c| c == ' ' || c == '\t'))
            {
                row
            } else {
                content
            }
        }
        None => source.len(),
    }
}

pub(crate) fn serialize_block(
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<String, PluginError> {
    if map.is_empty() {
        return Ok("---\n\n---\n".to_string());
    }
    let yaml =
        serde_yaml_ng::to_string(&serde_json::Value::Object(map.clone())).map_err(|and| {
            PluginError::BadArgs(Text::message(
                E_YAML,
                vec![Arg::text("reason", and.to_string())],
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
    fn serializes_empty_holds_the_delimiters() {
        let s = serialize_block(&serde_json::Map::new()).unwrap();
        assert_eq!(s, "---\n\n---\n");
    }

    #[test]
    fn serialize_preserves_key_order() {
        let mut m = serde_json::Map::new();
        m.insert("title".into(), serde_json::json!("ciao"));
        m.insert("done".into(), serde_json::json!(true));
        let s = serialize_block(&m).unwrap();
        let the_title = s.find("title").expect("title");
        let the_done = s.find("done").expect("done");
        assert!(the_title < the_done, "{s}");
        assert!(s.starts_with("---\n"));
        assert!(s.contains("ciao"));
    }

    #[test]
    fn parse_yaml_fallback_a_string() {
        assert_eq!(parse_yaml_value("true"), serde_json::json!(true));
        assert_eq!(parse_yaml_value("3"), serde_json::json!(3));
        assert_eq!(parse_yaml_value("[[page]]"), serde_json::json!("[[page]]"));
    }

    #[test]
    fn wikilink_a_hand() {
        assert_eq!(show_link(&LinkTarget::wiki("page")), "[[page]]");
        assert_eq!(
            show_link(&LinkTarget::Wiki {
                page: "page".into(),
                heading: Some("H".into()),
                block: None,
            }),
            "[[page#H]]"
        );
        assert_eq!(
            show_link(&LinkTarget::Wiki {
                page: "page".into(),
                heading: None,
                block: Some("b".into()),
            }),
            "[[page#^b]]"
        );
        assert_eq!(
            show_link(&LinkTarget::Url("https://esempio.test".into())),
            "https://esempio.test"
        );
    }

    #[test]
    fn bom_not_enters_in_the_span() {
        let s = "\u{FEFF}# ciao\n";
        assert_eq!(source_start(s), 3);
        assert_eq!(source_start("# ciao\n"), 0);
    }

    #[test]
    fn insert_without_frontmatter_leaves_the_body() {
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
        let body = &out[edit.text.len()..];
        assert_eq!(body, source);
    }

    fn apply(source: &str, edit: &TextEdit) -> String {
        format!(
            "{}{}{}",
            &source[..edit.span.start],
            edit.text,
            &source[edit.span.end..]
        )
    }

    fn frontmatter_model(values: serde_json::Map<String, serde_json::Value>) -> DocumentModel {
        let mut model = DocumentModel::empty(DocId::new("a.md"));
        model.frontmatter_present = true;
        model.frontmatter.0 = values;
        model
    }

    #[test]
    fn property_edit_preserves_unrelated_yaml_and_body_bytes() {
        let source = "\u{FEFF}---\r\ntitle: 'Vecchio' # titolo\r\n# resta qui\r\nnested:\r\n  child: true\r\nuntouched: \"citato\" # intatto\r\n---\r\n# Corpo\r\n";
        let mut values = serde_json::Map::new();
        values.insert("title".into(), serde_json::json!("Vecchio"));
        values.insert("nested".into(), serde_json::json!({ "child": true }));
        values.insert("untouched".into(), serde_json::json!("citato"));
        let model = frontmatter_model(values);

        let edit =
            edit_property_frontmatter(source, &model, "title", Some(&serde_json::json!("Nuovo")))
                .unwrap();
        let out = apply(source, &edit);
        assert!(out.contains("title: \"Nuovo\" # titolo\r\n"), "{out:?}");
        assert!(
            out.contains("# resta qui\r\nnested:\r\n  child: true\r\n"),
            "{out:?}"
        );
        assert!(
            out.contains("untouched: \"citato\" # intatto\r\n"),
            "{out:?}"
        );
        assert!(out.ends_with("---\r\n# Corpo\r\n"), "{out:?}");
    }

    #[test]
    fn property_add_and_remove_are_targeted_and_keep_crlf() {
        let source = "---\r\none: 1\r\n# separatore\r\ntwo: 2\r\n---\r\ncorpo\r\n";
        let mut values = serde_json::Map::new();
        values.insert("one".into(), serde_json::json!(1));
        values.insert("two".into(), serde_json::json!(2));
        let model = frontmatter_model(values);

        let removed = edit_property_frontmatter(source, &model, "one", None).unwrap();
        let without = apply(source, &removed);
        assert!(!without.contains("one:"), "{without:?}");
        assert!(
            without.contains("# separatore\r\ntwo: 2\r\n"),
            "{without:?}"
        );
        assert!(without.ends_with("---\r\ncorpo\r\n"), "{without:?}");

        let added =
            edit_property_frontmatter(source, &model, "new key", Some(&serde_json::json!([1, 2])))
                .unwrap();
        let with = apply(source, &added);
        assert!(with.contains("\"new key\": [1,2]\r\n---\r\n"), "{with:?}");
        assert!(with.ends_with("---\r\ncorpo\r\n"), "{with:?}");
    }

    #[test]
    fn unknown_yaml_shape_fails_instead_of_rewriting_the_block() {
        let source = "---\n? [complex, key]\n: value\n---\nbody\n";
        let mut values = serde_json::Map::new();
        values.insert("complex".into(), serde_json::json!("value"));
        let model = frontmatter_model(values);
        let error =
            edit_property_frontmatter(source, &model, "complex", Some(&serde_json::json!("next")))
                .unwrap_err();
        assert!(matches!(error, PluginError::BadArgs(_)));
    }
}
