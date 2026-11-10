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

mod catalog;
mod commands;
mod view;

pub use catalog::catalog;
pub use commands::PropertiesCommands;
pub use view::PropertiesView;
use view::{date_formats, frontmatter_span, property_types, show_date, show_link, show_list};

/// Id del componente (spazio dati/registrazione).
pub const PROPERTIES_ID: &str = "fub.properties";
/// Id della vista locale della nota.
pub const PROPERTIES_VIEW: &str = "properties";
/// Id della vista globale del vault.
pub const GLOBAL_PROPERTIES_VIEW: &str = "properties.global";
/// Id del contatore nella banda di stato: quante proprietà ha la nota attiva.
pub const PROPERTIES_STATUS_VIEW: &str = "properties.status";
/// Imposta (o aggiunge) una chiave del frontmatter.
pub const NOTES_PROPERTY_SET: &str = "note.property.set";
/// Toglie una chiave del frontmatter.
pub const NOTES_PROPERTY_REMOVE: &str = "note.property.remove";
/// Dichiara il tipo di una proprietà per questo vault.
pub const PROPERTY_TYPE_SET: &str = "property.type.set";
/// Rinomina una chiave frontmatter in tutte le note che la portano.
pub const PROPERTY_KEY_RENAME: &str = "property.key.rename";
/// Toglie una chiave frontmatter da tutte le note che la portano.
pub const PROPERTY_KEY_DELETE: &str = "property.key.delete";
/// Aggiunge un alias alla nota, nella lista `aliases` del frontmatter.
pub const NOTES_ALIAS_ADD: &str = "note.alias.add";
/// Toglie tutto il frontmatter della nota.
pub const NOTES_PROPERTIES_CLEAR: &str = "note.properties.clear";
/// Converte le chiavi vecchie di Obsidian (`tag`, `alias`, `cssclass`) nelle
/// plurali, su tutto il vault.
pub const PROPERTY_KEYS_MIGRATE: &str = "property.keys.migrate";

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
const STATUS_TITLE: &str = "status_title";
const STATUS_COUNT: &str = "status_count";
const GLOBAL_EMPTY: &str = "global_empty";
const GLOBAL_FILTER: &str = "global_filter";
const GLOBAL_COUNT: &str = "global_count";
const GLOBAL_VALUE_COUNT: &str = "global_value_count";
const GLOBAL_DOCS: &str = "global_docs";
const P_TYPE: &str = "p_type";
const P_RENAME: &str = "p_rename";
const U_RENAME: &str = "u_rename";
const P_DELETE: &str = "p_delete";
const U_DELETE: &str = "u_delete";
const P_MIGRATE: &str = "p_migrate";
const U_MIGRATE: &str = "u_migrate";

/// Le chiavi singolari che Obsidian ha sostituito con le plurali (1.4).
const LEGACY_KEYS: [(&str, &str); 3] = [
    ("tag", "tags"),
    ("alias", "aliases"),
    ("cssclass", "cssclasses"),
];
const ALIAS: &str = "alias";
const ALIASES: &str = "aliases";
const P_ALIAS: &str = "p_alias";
const P_ALIAS_PRESENT: &str = "p_alias_present";
const U_ALIAS: &str = "u_alias";
const P_CLEAR: &str = "p_clear";
const P_CLEAR_NONE: &str = "p_clear_none";
const U_CLEAR: &str = "u_clear";
const FAILED: &str = "failed";
/// La nota del giorno di una proprietà data: il percorso inverso di
/// `note.daily`, che la data la scrive nella giornaliera. Il comando si chiama
/// per id, come ogni comando di un'altra feature: con i modelli spenti non c'è,
/// e il pannello lo dice.
const DAILY: &str = "daily";
const DAILY_COMMAND: &str = "note.daily";
const DAILY_LABEL: &str = "daily_label";
const E_DAILY: &str = "e_daily";
const E_DAILY_OFF: &str = "e_daily_off";
/// Le altre note dello stesso giorno: il verso che manca a `note.daily`, da una
/// giornaliera (che ha la sua `date`) o da qualunque nota con una data. Il
/// giorno aperto vive nello stato della view, e la lista si ricalcola a ogni
/// resa: è la stessa lettura dell'indice che fa la vista globale.
const SAME_DAY: &str = "same_day";
const SAME_DAY_STATE: &str = "property.same_day";
const SAME_DAY_LABEL: &str = "same_day_label";
const SAME_DAY_TITLE: &str = "same_day_title";
const SAME_DAY_NONE: &str = "same_day_none";
const SAME_DAY_MORE: &str = "same_day_more";
/// Quante note dello stesso giorno si mostrano; le altre si contano.
const SAME_DAY_ROWS: usize = 50;
/// Una nota con la chiave al singolare e al plurale insieme: la conversione
/// non sceglie per l'utente.
const E_BOTH_FORMS: &str = "e_both_forms";

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

/// Parsa un frammento YAML in JSON. Se non è YAML, resta una stringa.
pub(crate) fn parse_yaml_value(s: &str) -> serde_json::Value {
    let t = s.trim();
    // `[[page]]` è YAML flow-sequence, non un wikilink. Si tiene stringa
    // **prima** del parse, altrimenti diventa `[["page"]]`.
    if t.starts_with("[[") && t.ends_with("]]") {
        return serde_json::Value::String(t.to_string());
    }
    // Uno YAML che il parser pagherebbe troppo resta testo, come uno rotto.
    if !fub_abi::rules::yaml::within_budget(s) {
        return serde_json::Value::String(s.to_string());
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
        // Oltre il tetto di `rules::yaml` il valore resta testo senza passare
        // dal parser, che su centomila `[` impiegherebbe secondi.
        let deep = "[".repeat(100_000);
        assert_eq!(parse_yaml_value(&deep), serde_json::json!(deep));
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
