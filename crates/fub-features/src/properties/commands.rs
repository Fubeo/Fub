//! I comandi delle proprietà della nota e del vault: impostare, togliere,
//! tipizzare, rinominare, cancellare, alias e migrazione delle chiavi.

use super::*;

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
            command(PROPERTY_KEY_DELETE)
                .with_param(parameter(PROPERTY_KEY_DELETE, KEY, ParamKind::Text).required())
                .with_scope(CommandScope::writing(CommandReach::Vault)),
            command(PROPERTY_KEYS_MIGRATE).with_scope(CommandScope::writing(CommandReach::Vault)),
            command(NOTES_ALIAS_ADD)
                .with_param(parameter(NOTES_ALIAS_ADD, ALIAS, ParamKind::Text).required())
                .with_param(parameter(NOTES_ALIAS_ADD, DOC, ParamKind::Document))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            command(NOTES_PROPERTIES_CLEAR)
                .with_param(parameter(NOTES_PROPERTIES_CLEAR, DOC, ParamKind::Document))
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
            PROPERTY_KEY_DELETE => delete_property_key(Args::new(&args), mode, host),
            PROPERTY_KEYS_MIGRATE => migrate_property_keys(mode, host),
            NOTES_ALIAS_ADD => add_alias(Args::new(&args), mode, host),
            NOTES_PROPERTIES_CLEAR => clear_properties(Args::new(&args), mode, host),
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

/// Un alias in più, accodato alla lista: un `aliases` scritto come stringa
/// diventa una lista con il vecchio valore davanti. Un vault che usa la chiave
/// singolare `alias` la tiene, se `aliases` non c'è.
fn add_alias(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_from(args, host)?;
    let alias = args.text(ALIAS).unwrap_or("").trim().to_string();
    if alias.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_KEY)));
    }
    let model = host.read_model(&doc)?;
    let key =
        if model.frontmatter.0.get(ALIASES).is_none() && model.frontmatter.0.get(ALIAS).is_some() {
            ALIAS
        } else {
            ALIASES
        };
    let mut list = match model.frontmatter.0.get(key) {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(serde_json::Value::Array(items)) => items.clone(),
        Some(other) => vec![other.clone()],
    };
    let named = vec![Arg::text(ALIAS, &alias), Arg::text(DOC, doc.as_str())];
    if list
        .iter()
        .any(|item| item.as_str() == Some(alias.as_str()))
    {
        return Ok(CommandOutcome::notify(Text::message(
            P_ALIAS_PRESENT,
            named,
        )));
    }
    list.push(serde_json::Value::String(alias.clone()));
    let value = serde_json::Value::Array(list);
    rewrite(
        key,
        &None,
        None,
        host,
        &doc,
        mode,
        Text::message(P_ALIAS, named),
        Text::message(U_ALIAS, vec![Arg::text(ALIAS, &alias)]),
        |map| {
            map.insert(key.to_string(), value.clone());
            Ok(())
        },
    )
}

/// Il blocco intero, dai delimitatori al terminatore della riga di chiusura: il
/// corpo resta byte per byte. Un frontmatter vuoto (`---` e `---`) si toglie
/// anche lui; una nota senza blocco non si tocca.
fn clear_properties(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_from(args, host)?;
    let revision = host.document_revision(&doc)?;
    let source = host.read_document(&doc)?;
    let named = || vec![Arg::text(DOC, doc.as_str())];
    let span = frontmatter_span(&source);
    if span.start == span.end {
        return Ok(CommandOutcome::notify(Text::message(P_CLEAR_NONE, named())));
    }
    let request = EditRequest::new(revision, vec![TextEdit::replace(span, String::new())]);
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                Text::message(P_CLEAR, named()),
                vec![PlannedEdit::new(doc.clone(), request)],
            ))),
        );
    }
    let report = host.apply_edit(&doc, request)?;
    Ok(CommandOutcome::notify(Text::message(P_CLEAR, named()))
        .undoable(Undo::of_edits(
            Text::message(U_CLEAR, named()),
            vec![PlannedEdit::new(doc.clone(), report.inverse())],
        ))
        .with_effect(CommandEffect::Done))
}

/// Il gemello di [`rename_property_key`]: stesse revisioni fissate prima di
/// scrivere, stesso esito parziale, e un annullo che rimette ogni valore. Il
/// tipo dichiarato resta: la chiave può tornare, e il registro non è un dato
/// delle note.
fn delete_property_key(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let key = key_from(args)?;
    let docs = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::of(QueryPredicate::Property {
                filter: PropertyFilter {
                    key: key.clone(),
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
    for entry in docs {
        let doc = entry.doc;
        let prepared = (|| -> Result<Option<PlannedEdit>, PluginError> {
            crate::formats::require(host, &doc, fub_abi::options::syntax::FRONTMATTER)?;
            let revision = host.document_revision(&doc)?;
            let source = host.read_document(&doc)?;
            let model = host.read_model(&doc)?;
            if model.frontmatter.get(&key).is_none() {
                return Ok(None); // già tolta: si può rilanciare
            }
            let edit = edit_property_frontmatter(&source, &model, &key, None)?;
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
            P_DELETE,
            vec![
                Arg::text(KEY, key.as_str()),
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
            Text::message(U_DELETE, vec![Arg::text(KEY, key.as_str())]),
            inverses,
        ));
    }
    Ok(outcome)
}

/// [`rename_property_key`] per le tre chiavi vecchie insieme: una nota sola
/// riceve le sue rinomine in una richiesta, così l'anteprima e l'annullo la
/// trattano intera. Una nota con entrambe le forme di una chiave non si tocca:
/// unire i due valori deciderebbe al posto di chi scrive.
fn migrate_property_keys(
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let mut docs: Vec<DocId> = Vec::new();
    for (old, _) in LEGACY_KEYS {
        let found = host
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
        for entry in found {
            if !docs.contains(&entry.doc) {
                docs.push(entry.doc);
            }
        }
    }
    let attempted = docs.len();
    let mut plans = Vec::with_capacity(attempted);
    let mut failures = Vec::new();
    for doc in docs {
        let prepared = (|| -> Result<Option<PlannedEdit>, PluginError> {
            crate::formats::require(host, &doc, fub_abi::options::syntax::FRONTMATTER)?;
            let revision = host.document_revision(&doc)?;
            let source = host.read_document(&doc)?;
            let model = host.read_model(&doc)?;
            let mut edits = Vec::new();
            for (old, new) in LEGACY_KEYS {
                if model.frontmatter.get(old).is_none() {
                    continue;
                }
                if model.frontmatter.get(new).is_some() {
                    return Err(PluginError::Conflict(Text::message(
                        E_BOTH_FORMS,
                        vec![
                            Arg::text(DOC, doc.as_str()),
                            Arg::text("old", old),
                            Arg::text("new", new),
                        ],
                    )));
                }
                edits.push(edit_property_key(&source, old, new)?);
            }
            if edits.is_empty() {
                return Ok(None); // già convertita: si può rilanciare
            }
            Ok(Some(PlannedEdit::new(
                doc.clone(),
                EditRequest::new(revision, edits),
            )))
        })();
        match prepared {
            Ok(Some(edit)) => plans.push(edit),
            Ok(None) => {}
            Err(error) => failures.push(Failure::of(doc, error)),
        }
    }
    let summary =
        |count: usize| Text::message(P_MIGRATE, vec![Arg::text("count", count.to_string())]);
    if mode.is_dry_run() {
        let planned = plans.len();
        return Ok(CommandOutcome::done()
            .with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                summary(planned),
                plans,
            )))
            .partially(Partial::of(attempted, planned, failures)));
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
        outcome = outcome.undoable(Undo::of_edits(Text::key(U_MIGRATE), inverses));
    }
    Ok(outcome)
}
