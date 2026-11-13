//! Il pannello proprietà della nota aperta: `PropertiesView`, l'albero, le
//! righe, i widget, le note dello stesso giorno e il modulo per aggiungere.

use super::*;

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
            ViewSpec::new(
                PROPERTIES_STATUS_VIEW,
                Text::key(STATUS_TITLE),
                ViewSurface::StatusBar,
            )
            .open_by_default(),
        ]
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        if instance.view == GLOBAL_PROPERTIES_VIEW {
            global_tree(host)
        } else if instance.view == PROPERTIES_STATUS_VIEW {
            status_count(host)
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
            DAILY => {
                let Some(date) = action.payload.get(VALUE).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                open_daily(host, date)
            }
            SAME_DAY => {
                let Some(date) = action.payload.get(VALUE).and_then(|v| v.as_str()) else {
                    return Ok(ViewUpdate::None);
                };
                // Lo stesso pulsante apre e chiude.
                let open = host.view_state(SAME_DAY_STATE)?;
                let next = (open.as_ref().and_then(|v| v.as_str()) != Some(date))
                    .then(|| serde_json::json!(date));
                host.set_view_state(SAME_DAY_STATE, next)?;
                Ok(ViewUpdate::Replace {
                    root: tree(host, None)?,
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
}

/// Apre (o crea) la giornaliera di `date` e ci porta. Ciò che `note.daily`
/// rifiuta resta scritto sopra le proprietà, come ogni altro rifiuto.
fn open_daily(host: &mut dyn HostApi, date: &str) -> Result<ViewUpdate, PluginError> {
    let warning = match host.run_command(DAILY_COMMAND, serde_json::json!({ "date": date })) {
        Ok(outcome) => match outcome.effect {
            CommandEffect::Navigate { doc } => {
                return Ok(ViewUpdate::Navigate {
                    doc_id: doc.as_str().to_string(),
                })
            }
            _ => return Ok(ViewUpdate::None),
        },
        Err(PluginError::UnknownCommand(_)) => Text::key(E_DAILY_OFF),
        Err(and) => Text::message(
            E_DAILY,
            vec![
                Arg::text("date", date),
                Arg::text("reason", and.to_string()),
            ],
        ),
    };
    Ok(ViewUpdate::Replace {
        root: tree(host, Some(warning))?,
    })
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
    let same_day = host
        .view_state(SAME_DAY_STATE)?
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|day| props.iter().any(|(_, v)| has_day(v, day)));
    if props.is_empty() {
        children.push(UiNode::empty_state(Text::key(EMPTY_NO_PROPS)));
    } else {
        children.extend(
            props
                .iter()
                .map(|(k, v)| row(&doc, k, v, model.frontmatter.get(k), same_day.as_deref())),
        );
    }
    if let Some(day) = &same_day {
        children.push(same_day_list(host, &doc, day)?);
    }
    children.push(add_form(&doc));
    Ok(UiNode::column(1, children))
}

/// Il contatore della banda di stato. Tace senza nota, su una nota senza
/// proprietà e su un documento che non ha un modello Markdown (un foglio, un
/// disegno): lì non c'è frontmatter da contare, e un errore nella banda non
/// direbbe niente di utile.
fn status_count(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let silent = || Ok(UiNode::row(12, Vec::new()));
    let Some(doc) = host.active_context().and_then(|c| c.doc) else {
        return silent();
    };
    let Ok(model) = host.read_model(&doc) else {
        return silent();
    };
    let count = model
        .frontmatter
        .properties_with_types(&date_formats(host), &property_types(host))
        .len();
    if count == 0 {
        return silent();
    }
    Ok(UiNode::text(Text::message(
        STATUS_COUNT,
        vec![Arg::int("count", i64::try_from(count).unwrap_or(i64::MAX))],
    ))
    .with_key(STATUS_COUNT))
}

pub(super) fn frontmatter_span(source: &str) -> Span {
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

pub(super) fn property_types(host: &dyn ReadApi) -> PropertyTypes {
    match host.setting(TYPES_KEY) {
        Ok(SettingValue::Text(raw)) => serde_json::from_str(&raw).unwrap_or_default(),
        _ => PropertyTypes::default(),
    }
}

pub(super) fn date_formats(host: &dyn ReadApi) -> DateFormats {
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

/// Il giorno scritto di una data, `AAAA-MM-GG`: ora e fuso non lo spostano,
/// perché è il giorno che l'utente ha scritto quello che cerca.
fn day_of(date: &fub_abi::model::PropertyDate) -> String {
    format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
}

/// Il valore porta questo giorno, da solo o dentro un elenco?
fn has_day(value: &PropertyValue, day: &str) -> bool {
    match value {
        PropertyValue::Date(date) => day_of(date) == day,
        PropertyValue::List(items) => items
            .iter()
            .any(|item| matches!(item, PropertyScalar::Date(date) if day_of(date) == day)),
        _ => false,
    }
}

/// Le altre note che hanno, in una proprietà qualsiasi, una data di quel
/// giorno. Le chiavi non si sanno prima (`date`, `created`, `scadenza`…): si
/// leggono le proprietà dall'indice, come fa la vista globale, e si guarda il
/// valore già tipato.
fn same_day_list(host: &dyn ReadApi, doc: &DocId, day: &str) -> Result<UiNode, PluginError> {
    let documents = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::all(),
            sort: None,
            select: PropertySelect::All,
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?;
    let mut others: Vec<DocId> = documents
        .items
        .into_iter()
        .filter(|m| &m.doc != doc && m.properties.iter().any(|p| has_day(&p.value, day)))
        .map(|m| m.doc)
        .collect();
    others.sort();
    let date = Arg::text("date", day);
    if others.is_empty() {
        return Ok(
            UiNode::empty_state(Text::message(SAME_DAY_NONE, vec![date])).with_key(SAME_DAY),
        );
    }
    let hidden = others.len().saturating_sub(SAME_DAY_ROWS);
    let items: Vec<UiNode> = others
        .iter()
        .take(SAME_DAY_ROWS)
        .map(|other| {
            UiNode::list_item(
                Text::from(other.as_str().to_string()),
                None,
                Some(ActionRef::with(
                    OPEN,
                    serde_json::json!({ DOC: other.as_str() }),
                )),
            )
            .with_key(other.as_str())
        })
        .collect();
    let mut entries = vec![
        UiNode::text(Text::message(SAME_DAY_TITLE, vec![date])),
        UiNode::list(items),
    ];
    if hidden > 0 {
        entries.push(UiNode::text(Text::message(
            SAME_DAY_MORE,
            vec![Arg::int("count", i64::try_from(hidden).unwrap_or(i64::MAX))],
        )));
    }
    Ok(UiNode::keyed(
        SAME_DAY,
        UiKind::Stack {
            dir: fub_abi::ui::Axis::Column,
            gap: 1,
            children: entries,
        },
    ))
}

fn row(
    doc: &DocId,
    key: &str,
    value: &PropertyValue,
    raw: Option<&serde_json::Value>,
    same_day: Option<&str>,
) -> UiNode {
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
        if let PropertyValue::Date(date) = value {
            let day = day_of(date);
            controls.push(UiNode::button(
                Text::key(DAILY_LABEL),
                Intent::Neutral,
                ActionRef::with(DAILY, serde_json::json!({ VALUE: day })),
            ));
            controls.push(UiNode::button(
                Text::key(SAME_DAY_LABEL),
                if same_day == Some(day.as_str()) {
                    Intent::Primary
                } else {
                    Intent::Neutral
                },
                ActionRef::with(SAME_DAY, serde_json::json!({ VALUE: day })),
            ));
        }
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

pub(super) fn show_link(t: &LinkTarget) -> String {
    match t {
        LinkTarget::Wiki { .. } => match t.wiki_inner() {
            Some(inner) => format!("[[{inner}]]"),
            None => String::new(),
        },
        LinkTarget::Url(s) | LinkTarget::Path(s) => s.clone(),
    }
}
pub(super) fn show_date(date: &fub_abi::model::PropertyDate) -> String {
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

pub(super) fn show_list(items: &[fub_abi::model::PropertyScalar]) -> String {
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
