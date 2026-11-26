//! Stateless `.base` query provider. Document selection remains `Documents` in
//! the generic index registry; this provider plans and evaluates a definition.
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use fub_abi::command::{
    Args, CommandEffect, CommandOutcome, CommandPlan, CommandReach, CommandScope, CommandSpec,
    InvokeMode, ParamKind, ParamSpec, PlannedEdit, Undo,
};
use fub_abi::edit::{EditRequest, Revision};
use fub_abi::error::PluginError;
use fub_abi::model::{DateFormats, LinkTarget, PropertyDate, PropertyScalar, PropertyValue};
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    CommandProvider, HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryKind,
    QueryRoute, VaultEntry,
};
use fub_abi::{DocId, DocumentModel};
use fub_format_base::formula::{
    BaseValue, EvalBudget, Formula, FormulaErrorCode, LinkedNote, LinkedNotes, RowContext,
};
use fub_format_base::model::{BaseError, FilterOp, BASE_FORMAT_ID};
use fub_format_base::patch::{self, BaseChange, PatchError, Place, ViewKey};
use fub_format_base::{
    AggregateKind, BaseDefinition, BaseViewDef, FilterDef, SummaryDef, ViewType,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub const BASE_ID: &str = "fub.base";
pub const MAX_BASE_QUERY_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_BASE_ROWS_PER_CALL: usize = 20_000;
pub const MAX_BASE_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// A size check must not allocate another large JSON buffer.
fn check_json_size(value: &Value, max: usize, label: &str) -> Result<(), PluginError> {
    struct Counter {
        remaining: usize,
    }
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if bytes.len() > self.remaining {
                return Err(std::io::Error::other("JSON byte budget exceeded"));
            }
            self.remaining -= bytes.len();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(Counter { remaining: max }, value).map_err(|error| {
        bad(format!(
            "base: {label} supera il limite di {max} byte: {error}"
        ))
    })
}

/// Derivation has no cache: each reload reads at most 20k indexed notes and
/// evaluates at most 5k formula steps per note. Summary expressions share a
/// 2m-step budget across all filtered members. Any member change, removal,
/// rename, index refresh or lost event requires a full re-query (including
/// search, sorts, aggregates); IndexLoss is empty because nothing is persisted.
pub struct BaseIndex;
impl BaseIndex {
    pub fn new() -> Self {
        Self
    }
}
impl Default for BaseIndex {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Deserialize)]
struct Request {
    version: u32,
    op: String,
    source: String,
    #[serde(default)]
    view: Option<String>,
    /// Host document path; omitted means no container, not the first member.
    #[serde(default)]
    container: Option<String>,
    #[serde(default)]
    rows: Vec<InputRow>,
    #[serde(default)]
    edits: Vec<Edit>,
    #[serde(default)]
    now_ms: Option<i64>,
    /// Le note legate dalle Relazioni che i riepiloghi leggono (`rollup`),
    /// una per pagina di link risolta; assente vuol dire nessuna nota legata.
    #[serde(default)]
    linked: Vec<InputLinked>,
}
#[derive(Deserialize)]
struct InputRow {
    doc: String,
    props: BTreeMap<String, PropertyValue>,
}
/// Una nota legata: la pagina del link com'è scritta nella Relazione (`Dune`
/// per `[[Dune]]`), il documento a cui chi chiama l'ha risolta con le regole
/// del vault, e le proprietà che il piano chiede (`linked_props`). Una pagina
/// che non risolve non si manda: è un link rotto.
///
/// `folder` è la cartella delle righe da cui la pagina è stata risolta (`""`
/// la radice): lo stesso `[[Indice]]` o `./nota.md` in due cartelle porta a
/// due note, e ognuna vale per le righe della sua. Senza, la nota vale per
/// tutte le righe; con, vince su quella senza.
#[derive(Deserialize)]
struct InputLinked {
    target: String,
    #[serde(default)]
    folder: Option<String>,
    doc: String,
    props: BTreeMap<String, PropertyValue>,
}
#[derive(Deserialize)]
struct Edit {
    doc: String,
    key: String,
    expected: Value,
    #[serde(default)]
    value: Option<String>,
}
struct Planned<'a> {
    definition: &'a BaseDefinition,
    view: &'a BaseViewDef,
    formulas: BTreeMap<String, Result<Formula, FormulaErrorCode>>,
}
fn bad(message: impl Into<String>) -> PluginError {
    PluginError::BadArgs(Text::from(message.into()))
}
fn check_intermediate(value: &BaseValue) -> Result<(), PluginError> {
    use fub_format_base::formula::{MAX_TEXT_BYTES, MAX_TEXT_LIST_ITEMS};
    match value {
        BaseValue::Text(text) if text.len() > MAX_TEXT_BYTES => {
            Err(bad("base: testo oltre il budget"))
        }
        BaseValue::List(items) if items.len() > MAX_TEXT_LIST_ITEMS => {
            Err(bad("base: lista oltre il budget"))
        }
        BaseValue::List(items) => items.iter().try_for_each(check_intermediate),
        BaseValue::Object(fields) if fields.len() > MAX_TEXT_LIST_ITEMS => {
            Err(bad("base: oggetto oltre il budget"))
        }
        BaseValue::Object(fields) => fields.values().try_for_each(check_intermediate),
        _ => Ok(()),
    }
}
fn planned<'a>(
    definition: &'a BaseDefinition,
    name: Option<&str>,
) -> Result<Planned<'a>, PluginError> {
    let view = match name {
        Some(name) => definition.views.iter().find(|v| v.name == name),
        None => definition.views.first(),
    }
    .ok_or_else(|| bad("base: vista inesistente"))?;
    let formulas = definition
        .formulas
        .iter()
        .map(|f| {
            (
                f.name.clone(),
                Formula::parse(&f.expression).map_err(|e| e.code()),
            )
        })
        .collect();
    Ok(Planned {
        definition,
        view,
        formulas,
    })
}
fn columns(plan: &Planned<'_>) -> Vec<String> {
    if !plan.view.order.is_empty() {
        return plan.view.order.clone();
    }
    let mut columns = Vec::new();
    for key in plan
        .view
        .sort
        .iter()
        .map(|sort| &sort.key)
        .chain(plan.view.summaries.iter().map(|summary| &summary.key))
        .chain(
            plan.definition
                .properties
                .iter()
                .map(|property| &property.key),
        )
    {
        if !columns.contains(key) {
            columns.push(key.clone());
        }
    }
    columns
}
fn required(plan: &Planned<'_>) -> Result<Vec<String>, PluginError> {
    let mut keys = BTreeSet::new();
    for key in columns(plan) {
        if let Some(key) = key.strip_prefix("prop.") {
            keys.insert(key.to_string());
        } else if !key.contains('.') && !plan.formulas.contains_key(&key) {
            keys.insert(key);
        }
    }
    for key in plan
        .view
        .sort
        .iter()
        .map(|s| &s.key)
        .chain(plan.view.group.iter().map(|g| &g.key))
        .chain(plan.view.summaries.iter().map(|s| &s.key))
    {
        if let Some(key) = key.strip_prefix("prop.") {
            keys.insert(key.to_string());
        } else if !key.contains('.') && !plan.formulas.contains_key(key) {
            keys.insert(key.to_string());
        }
    }
    if let Some(map) = &plan.view.map {
        for key in [&map.lat_key, &map.lon_key]
            .into_iter()
            .chain(map.label_key.iter())
            .chain(map.color_key.iter())
        {
            if let Some(field) = key.strip_prefix("file.") {
                check_file_field(field)?;
            }
            if let Some(key) = key.strip_prefix("prop.") {
                keys.insert(key.to_string());
            } else if !key.contains('.') && !plan.formulas.contains_key(key.as_str()) {
                keys.insert(key.clone());
            }
        }
    }
    // La data del calendario e inizio e fine della linea del tempo sono
    // proprietà da leggere, come una colonna.
    let (date, start, end) = time_keys(plan.view);
    keys.extend([date, start, end].into_iter().flatten().map(str::to_string));
    collect_filter(&plan.definition.filters, &mut keys);
    collect_filter(&plan.view.filters, &mut keys);
    for summary in &plan.view.summaries {
        if let Some(expression) = &summary.expression {
            if let Ok(formula) = Formula::parse(expression) {
                keys.extend(formula.prop_deps);
                for field in &formula.file_deps {
                    check_file_field(field)?;
                }
                for field in &formula.container_deps {
                    check_file_field(field)?;
                }
            }
        }
    }
    for formula in plan.formulas.values().filter_map(|v| v.as_ref().ok()) {
        keys.extend(formula.prop_deps.iter().cloned());
        for field in &formula.file_deps {
            check_file_field(field)?;
        }
        for field in &formula.container_deps {
            check_file_field(field)?;
        }
    }
    validate_filter(&plan.definition.filters)?;
    validate_filter(&plan.view.filters)?;
    for key in columns(plan)
        .iter()
        .chain(plan.view.sort.iter().map(|s| &s.key))
        .chain(plan.view.group.iter().map(|g| &g.key))
        .chain(plan.view.summaries.iter().map(|s| &s.key))
    {
        if let Some(field) = key.strip_prefix("file.") {
            check_file_field(field)?;
        }
        if let Some(field) = key.strip_prefix("container.") {
            check_file_field(field)?;
        }
    }
    Ok(keys.into_iter().collect())
}
/// Le Relazioni che i riepiloghi (`rollup`) della vista leggono, e le
/// proprietà delle note legate che chiedono: dalle formule della base e dalle
/// espressioni dei riepiloghi della vista. Il piano le dice alla superficie,
/// che risolve i link di quelle Relazioni e manda le note legate a `derive`.
fn rollup_deps(plan: &Planned<'_>) -> (Vec<String>, Vec<String>) {
    let mut relations = BTreeSet::new();
    let mut linked = BTreeSet::new();
    let summaries = plan
        .view
        .summaries
        .iter()
        .filter_map(|summary| summary.expression.as_deref())
        .filter_map(|source| Formula::parse(source).ok());
    for formula in plan
        .formulas
        .values()
        .filter_map(|f| f.as_ref().ok())
        .cloned()
        .chain(summaries)
    {
        relations.extend(formula.relation_deps);
        linked.extend(formula.linked_deps);
    }
    (
        relations.into_iter().collect(),
        linked.into_iter().collect(),
    )
}
/// Le note legate della richiesta, una volta per derivazione, come le legge
/// ogni riga: quelle senza cartella valgono per tutte (`any`), quelle con una
/// cartella per le righe di quella (`folders`, già unite a `any`).
struct LinkedByFolder {
    any: Arc<LinkedNotes>,
    folders: BTreeMap<String, Arc<LinkedNotes>>,
}

impl LinkedByFolder {
    /// Le note legate dal punto di vista della riga `doc`.
    fn of_row(&self, doc: &str) -> Arc<LinkedNotes> {
        let folder = doc.rsplit_once('/').map(|(f, _)| f).unwrap_or("");
        Arc::clone(self.folders.get(folder).unwrap_or(&self.any))
    }
}

fn linked_notes(linked: Vec<InputLinked>) -> Result<LinkedByFolder, PluginError> {
    if linked.len() > MAX_BASE_ROWS_PER_CALL {
        return Err(bad("base: troppe note legate per derivazione"));
    }
    let mut notes = LinkedNotes::new();
    let mut by_folder: BTreeMap<String, LinkedNotes> = BTreeMap::new();
    for input in linked {
        if input.target.is_empty() || input.doc.is_empty() {
            return Err(bad("base: nota legata senza pagina o documento"));
        }
        let props: BTreeMap<String, BaseValue> = input
            .props
            .iter()
            .map(|(k, v)| (k.clone(), property_value(v)))
            .collect();
        for value in props.values() {
            check_intermediate(value)?;
        }
        let note = LinkedNote {
            doc: input.doc,
            props,
        };
        match input.folder {
            Some(folder) => by_folder
                .entry(folder)
                .or_default()
                .insert(input.target, note),
            None => notes.insert(input.target, note),
        };
    }
    let folders = by_folder
        .into_iter()
        .map(|(folder, own)| {
            let mut all = notes.clone();
            all.extend(own);
            (folder, Arc::new(all))
        })
        .collect();
    Ok(LinkedByFolder {
        any: Arc::new(notes),
        folders,
    })
}
fn check_file_field(field: &str) -> Result<(), PluginError> {
    if matches!(field, "path" | "name" | "folder" | "ext") {
        Ok(())
    } else {
        Err(bad(format!("base: metadato file non disponibile: {field}")))
    }
}
fn collect_filter(filter: &FilterDef, keys: &mut BTreeSet<String>) {
    match filter {
        FilterDef::And(parts) | FilterDef::Or(parts) => {
            for part in parts {
                collect_filter(part, keys);
            }
        }
        FilterDef::Not(part) => collect_filter(part, keys),
        FilterDef::Condition { property, .. } => {
            if let Some(p) = property {
                keys.insert(p.strip_prefix("prop.").unwrap_or(p).to_string());
            }
        }
        FilterDef::All => {}
    }
}
fn validate_filter(filter: &FilterDef) -> Result<(), PluginError> {
    match filter {
        FilterDef::And(parts) | FilterDef::Or(parts) => {
            for part in parts {
                validate_filter(part)?;
            }
        }
        FilterDef::Not(part) => validate_filter(part)?,
        FilterDef::Condition {
            file,
            property,
            formula,
            tag,
            ..
        } => {
            if [
                file.is_some(),
                property.is_some(),
                formula.is_some(),
                tag.is_some(),
            ]
            .into_iter()
            .filter(|yes| *yes)
            .count()
                != 1
            {
                return Err(bad("base: filtro deve indicare un solo campo"));
            }
            // DocumentMatch only carries selected frontmatter properties; the
            // authoritative inline tags belong to the index, not to `props`.
            if tag.is_some() {
                return Err(bad(
                    "base: filtro tag richiede il predicato tag dell'indice",
                ));
            }
            if let Some(field) = file {
                check_file_field(field)?;
            }
        }
        FilterDef::All => {}
    }
    Ok(())
}
/// Only equalities implied by every branch are safe for a newly created note.
/// Contradictory equalities are dropped instead of manufacturing a match.
fn defaults_for(filter: &FilterDef) -> BTreeMap<String, Value> {
    match filter {
        FilterDef::Condition {
            property: Some(key),
            op: FilterOp::Is,
            value,
            ..
        } if !value.is_null() && !key.starts_with("file.") && !key.starts_with("formula.") => {
            BTreeMap::from([(
                key.strip_prefix("prop.").unwrap_or(key).to_string(),
                value.clone(),
            )])
        }
        FilterDef::And(parts) => {
            let mut out = BTreeMap::new();
            let mut conflicts = BTreeSet::new();
            for part in parts {
                for (key, value) in defaults_for(part) {
                    if out.get(&key).is_some_and(|prior| prior != &value) {
                        conflicts.insert(key.clone());
                    } else if !conflicts.contains(&key) {
                        out.insert(key, value);
                    }
                }
            }
            for key in conflicts {
                out.remove(&key);
            }
            out
        }
        FilterDef::Or(parts) => {
            let Some(first) = parts.first() else {
                return BTreeMap::new();
            };
            let mut out = defaults_for(first);
            for part in &parts[1..] {
                let branch = defaults_for(part);
                out.retain(|key, value| branch.get(key) == Some(value));
            }
            out
        }
        _ => BTreeMap::new(),
    }
}
fn create_defaults(global: &FilterDef, local: &FilterDef) -> BTreeMap<String, Value> {
    defaults_for(&FilterDef::And(vec![global.clone(), local.clone()]))
}
/// Un file `.base`: la definizione di una Base, che nessuna Base elenca.
fn is_base_definition(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .is_some_and(|(stem, ext)| !stem.is_empty() && ext.eq_ignore_ascii_case("base"))
}
fn file_fields(path: &str) -> BTreeMap<String, BaseValue> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let folder = path.rsplit_once('/').map(|(f, _)| f).unwrap_or("");
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    BTreeMap::from([
        ("path".into(), BaseValue::Text(path.into())),
        ("name".into(), BaseValue::Text(name.into())),
        ("folder".into(), BaseValue::Text(folder.into())),
        ("ext".into(), BaseValue::Text(ext.into())),
    ])
}
fn date_ms(date: PropertyDate) -> Option<i64> {
    // Civil date to Unix days; no implicit local timezone conversion.
    if !(1..=12).contains(&date.month) || !(1..=31).contains(&date.day) {
        return None;
    }
    let mut y = i64::from(date.year);
    let m = i64::from(date.month);
    y -= i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = m + if m > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + i64::from(date.day) - 1;
    let days = era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
    let (time_ms, offset) = match date.time {
        None => (0, 0),
        Some(time) => (
            i64::from(time.hour) * 3_600_000
                + i64::from(time.minute) * 60_000
                + i64::from(time.second) * 1000,
            i64::from(time.offset_minutes?),
        ),
    };
    days.checked_mul(86_400_000)?
        .checked_add(time_ms - offset * 60_000)
}
fn property_value(value: &PropertyValue) -> BaseValue {
    match value {
        PropertyValue::Empty => BaseValue::Empty,
        PropertyValue::Text(text) => BaseValue::Text(text.clone()),
        PropertyValue::Number(number) => BaseValue::Number(*number),
        PropertyValue::Bool(boolean) => BaseValue::Bool(*boolean),
        PropertyValue::Date(date) => date_ms(*date)
            .map(BaseValue::Date)
            .unwrap_or(BaseValue::Error(FormulaErrorCode::Value)),
        PropertyValue::Link(link) => match link {
            LinkTarget::Wiki {
                page,
                heading,
                block,
            } => {
                let mut target = page.clone();
                if let Some(heading) = heading {
                    target.push('#');
                    target.push_str(heading);
                }
                if let Some(block) = block {
                    target.push_str("#^");
                    target.push_str(block);
                }
                BaseValue::Link {
                    target,
                    label: None,
                }
            }
            LinkTarget::Path(path) | LinkTarget::Url(path) => BaseValue::Link {
                target: path.clone(),
                label: None,
            },
        },
        PropertyValue::List(items) => BaseValue::List(items.iter().map(scalar_value).collect()),
        PropertyValue::Unknown(raw) => json_value(raw),
    }
}
fn scalar_value(value: &PropertyScalar) -> BaseValue {
    match value {
        PropertyScalar::Empty => BaseValue::Empty,
        PropertyScalar::Text(text) => BaseValue::Text(text.clone()),
        PropertyScalar::Number(number) => BaseValue::Number(*number),
        PropertyScalar::Bool(boolean) => BaseValue::Bool(*boolean),
        PropertyScalar::Date(date) => date_ms(*date)
            .map(BaseValue::Date)
            .unwrap_or(BaseValue::Error(FormulaErrorCode::Value)),
        PropertyScalar::Link(LinkTarget::Wiki {
            page,
            heading,
            block,
        }) => {
            let mut target = page.clone();
            if let Some(heading) = heading {
                target.push('#');
                target.push_str(heading);
            }
            if let Some(block) = block {
                target.push_str("#^");
                target.push_str(block);
            }
            BaseValue::Link {
                target,
                label: None,
            }
        }
        PropertyScalar::Link(LinkTarget::Path(path) | LinkTarget::Url(path)) => BaseValue::Link {
            target: path.clone(),
            label: None,
        },
        PropertyScalar::Unknown(raw) => json_value(raw),
    }
}
fn json_value(value: &Value) -> BaseValue {
    match value {
        Value::Null => BaseValue::Empty,
        Value::String(s) => BaseValue::Text(s.clone()),
        Value::Bool(b) => BaseValue::Bool(*b),
        Value::Number(n) => n
            .as_f64()
            .filter(|n| n.is_finite())
            .map(BaseValue::Number)
            .unwrap_or(BaseValue::Error(FormulaErrorCode::Value)),
        Value::Array(items) => BaseValue::List(items.iter().map(json_value).collect()),
        Value::Object(map) => BaseValue::Object(
            map.iter()
                .map(|(key, value)| (key.clone(), json_value(value)))
                .collect(),
        ),
    }
}
fn evaluate_formula(
    name: &str,
    plan: &Planned<'_>,
    ctx: &mut RowContext,
    visiting: &mut BTreeSet<String>,
    budget: &mut EvalBudget,
) -> BaseValue {
    if let Some(value) = ctx.formulas.get(name) {
        return value.clone();
    }
    if !visiting.insert(name.to_string()) {
        return BaseValue::Error(FormulaErrorCode::Cycle);
    }
    let result = match plan.formulas.get(name) {
        Some(Ok(formula)) => {
            for dependency in &formula.dependencies {
                let value = evaluate_formula(dependency, plan, ctx, visiting, budget);
                ctx.formulas.insert(dependency.clone(), value);
            }
            if formula.dependencies.iter().any(|dep| {
                matches!(
                    ctx.formulas.get(dep),
                    Some(BaseValue::Error(FormulaErrorCode::Cycle))
                )
            }) {
                BaseValue::Error(FormulaErrorCode::Cycle)
            } else {
                formula.evaluate(ctx, budget)
            }
        }
        Some(Err(error)) => BaseValue::Error(*error),
        None => BaseValue::Error(FormulaErrorCode::Name),
    };
    visiting.remove(name);
    ctx.formulas.insert(name.to_string(), result.clone());
    result
}
fn field(key: &str, ctx: &RowContext) -> BaseValue {
    if let Some(key) = key.strip_prefix("prop.") {
        ctx.props.get(key)
    } else if let Some(key) = key.strip_prefix("file.") {
        ctx.file.get(key)
    } else if let Some(key) = key.strip_prefix("formula.") {
        ctx.formulas.get(key)
    } else if let Some(key) = key.strip_prefix("container.") {
        ctx.container.get(key)
    } else {
        ctx.props
            .get(key)
            .or_else(|| ctx.formulas.get(key))
            .or_else(|| ctx.file.get(key))
    }
    .cloned()
    .unwrap_or(BaseValue::Empty)
}
fn compare_rank(value: &BaseValue) -> u8 {
    match value {
        BaseValue::Number(_) => 0,
        BaseValue::Date(_) | BaseValue::Duration(_) => 1,
        BaseValue::Bool(_) => 2,
        BaseValue::Text(_) => 3,
        BaseValue::File { .. } | BaseValue::Link { .. } => 4,
        BaseValue::List(_) => 5,
        BaseValue::Object(_) => 6,
        BaseValue::Empty => 7,
        BaseValue::Error(_) => 8,
    }
}
fn compare(left: &BaseValue, right: &BaseValue) -> Ordering {
    match compare_rank(left).cmp(&compare_rank(right)) {
        Ordering::Equal => match (left, right) {
            (BaseValue::Number(a), BaseValue::Number(b)) => a.total_cmp(b),
            (BaseValue::Date(a), BaseValue::Date(b))
            | (BaseValue::Duration(a), BaseValue::Duration(b)) => a.cmp(b),
            (BaseValue::Bool(a), BaseValue::Bool(b)) => a.cmp(b),
            _ => left.display().cmp(&right.display()),
        },
        other => other,
    }
}
/// Un valore pronto per l'ordinamento, ricavato una volta per riga: il
/// comparatore lo confronta O(n log n) volte, e ricavarlo lì clonava il valore
/// e ne ricostruiva il testo a ogni confronto. Il testo c'è per le specie che
/// [`compare`] confronta dal testo.
struct SortKey {
    value: BaseValue,
    text: String,
}
impl SortKey {
    fn of(value: BaseValue) -> Self {
        let text = match value {
            BaseValue::Empty | BaseValue::Number(_) | BaseValue::Bool(_) => String::new(),
            _ => value.display(),
        };
        SortKey { value, text }
    }
    /// Lo stesso ordine di [`compare`] sui valori.
    fn cmp(&self, other: &Self) -> Ordering {
        match (&self.value, &other.value) {
            (BaseValue::Number(a), BaseValue::Number(b)) => a.total_cmp(b),
            (BaseValue::Date(a), BaseValue::Date(b))
            | (BaseValue::Duration(a), BaseValue::Duration(b)) => a.cmp(b),
            (BaseValue::Bool(a), BaseValue::Bool(b)) => a.cmp(b),
            (left, right) => match compare_rank(left).cmp(&compare_rank(right)) {
                Ordering::Equal => self.text.cmp(&other.text),
                other => other,
            },
        }
    }
}
fn compare_filter(left: &BaseValue, right: &BaseValue) -> Option<Ordering> {
    match (left, right) {
        (BaseValue::Number(a), BaseValue::Number(b)) => a.partial_cmp(b),
        (BaseValue::Date(a), BaseValue::Date(b))
        | (BaseValue::Duration(a), BaseValue::Duration(b)) => Some(a.cmp(b)),
        (BaseValue::Text(a), BaseValue::Text(b)) => Some(a.cmp(b)),
        (BaseValue::Bool(a), BaseValue::Bool(b)) => Some(a.cmp(b)),
        _ => None,
    }
}
/// Il valore di una condizione letto nella specie della proprietà che
/// confronta. Il file `.base` scritto a mano, o da un'altra app, dice spesso
/// `value: "2026-03-01"` o `value: "3000"` fra virgolette: una data ISO si
/// confronta con una data e un numero scritto come testo con un numero,
/// invece di non trovare niente. Solo la forma canonica: la data ISO-8601 e il
/// numero col punto (`3000.5`); la lingua dell'interfaccia la traduce la
/// barra prima di scrivere. Un testo che non si legge resta testo.
fn aligned(left: &BaseValue, right: BaseValue) -> BaseValue {
    let BaseValue::Text(text) = &right else {
        return right;
    };
    let text = text.trim();
    let read = match left {
        BaseValue::Date(_) => {
            match PropertyValue::normalize(&Value::String(text.into()), &DateFormats::ISO) {
                PropertyValue::Date(date) => date_ms(date).map(BaseValue::Date),
                _ => None,
            }
        }
        BaseValue::Number(_) => text
            .parse::<f64>()
            .ok()
            .filter(|number| number.is_finite())
            .map(BaseValue::Number),
        _ => None,
    };
    read.unwrap_or(right)
}
/// `contains` come quello della ricerca (`fub_abi::rules::properties`):
/// elenco → appartenenza, testo → sottostringa senza distinguere le
/// maiuscole, il resto → uguaglianza. Le stesse parole nella barra di ricerca
/// e nel filtro della Base dicono la stessa cosa.
fn contains(left: &BaseValue, right: &BaseValue) -> bool {
    match (left, right) {
        (BaseValue::Text(text), BaseValue::Text(needle)) => {
            text.to_lowercase().contains(needle.to_lowercase().as_str())
        }
        (BaseValue::List(items), wanted) => items.contains(wanted),
        _ => left == right,
    }
}
/// Il giorno civile di ogni proprietà data che ha anche un orario, come
/// epoch-ms della mezzanotte di quel giorno: `2026-03-18T01:00+02:00` è il 18,
/// anche se in UTC è ancora il 17. Serve a [`matches_filter`] per confrontare
/// una data senza orario con il giorno, non con l'istante.
fn civil_days(props: &BTreeMap<String, PropertyValue>) -> BTreeMap<String, i64> {
    props
        .iter()
        .filter_map(|(key, value)| match value {
            PropertyValue::Date(date) if date.time.is_some() => date_ms(PropertyDate {
                time: None,
                ..*date
            })
            .map(|day| (key.clone(), day)),
            _ => None,
        })
        .collect()
}
/// Il valore di una condizione è una data senza orario (`2026-03-18`)?
fn bare_date(value: &BaseValue) -> bool {
    let BaseValue::Text(text) = value else {
        return false;
    };
    matches!(
        PropertyValue::normalize(&Value::String(text.trim().into()), &DateFormats::ISO),
        PropertyValue::Date(PropertyDate { time: None, .. })
    )
}
/// Una riga passa il filtro? Una data senza orario nel filtro dice un giorno:
/// «è 2026-03-18» trova anche `2026-03-18T09:30+01:00`, «dopo» parte dal 19,
/// «prima» si ferma al 17. È la regola della barra, che a vista mostra e
/// scrive le date senza orario.
fn matches_filter(filter: &FilterDef, ctx: &RowContext, days: &BTreeMap<String, i64>) -> bool {
    match filter {
        FilterDef::All => true,
        FilterDef::And(parts) => parts.iter().all(|part| matches_filter(part, ctx, days)),
        FilterDef::Or(parts) => parts.iter().any(|part| matches_filter(part, ctx, days)),
        FilterDef::Not(part) => !matches_filter(part, ctx, days),
        FilterDef::Condition {
            property,
            file,
            formula,
            tag,
            op,
            value,
        } => {
            let left = if tag.is_some() {
                field("tags", ctx)
            } else if let Some(name) = property {
                ctx.props
                    .get(name.strip_prefix("prop.").unwrap_or(name))
                    .cloned()
                    .unwrap_or(BaseValue::Empty)
            } else if let Some(name) = file {
                field(&format!("file.{name}"), ctx)
            } else if let Some(name) = formula {
                field(&format!("formula.{name}"), ctx)
            } else {
                return false;
            };
            let right = tag
                .as_ref()
                .map(|s| BaseValue::Text(s.clone()))
                .unwrap_or_else(|| json_value(value));
            // Il giorno anche per un orario senza fuso, che come istante non
            // si legge (e resta un errore per ogni altro confronto).
            let left = match property {
                Some(name) if tag.is_none() && bare_date(&right) => days
                    .get(name.strip_prefix("prop.").unwrap_or(name))
                    .map(|day| BaseValue::Date(*day))
                    .unwrap_or(left),
                _ => left,
            };
            if matches!(left, BaseValue::Error(_)) {
                return false;
            }
            let right = aligned(&left, right);
            match op {
                FilterOp::Is => left == right,
                FilterOp::IsNot => left != right,
                FilterOp::Contains => contains(&left, &right),
                FilterOp::NotContains => !contains(&left, &right),
                FilterOp::HasTag => match &left {
                    BaseValue::List(items) => items.contains(&right),
                    BaseValue::Text(text) => {
                        text.split(',').any(|item| item.trim() == right.display())
                    }
                    _ => false,
                },
                FilterOp::GreaterThan => compare_filter(&left, &right) == Some(Ordering::Greater),
                FilterOp::GreaterThanOrEqual => matches!(
                    compare_filter(&left, &right),
                    Some(Ordering::Greater | Ordering::Equal)
                ),
                FilterOp::LessThan => compare_filter(&left, &right) == Some(Ordering::Less),
                FilterOp::LessThanOrEqual => matches!(
                    compare_filter(&left, &right),
                    Some(Ordering::Less | Ordering::Equal)
                ),
                FilterOp::IsEmpty => left.is_empty(),
                FilterOp::IsNotEmpty => !left.is_empty(),
                FilterOp::InFolder => {
                    let folder = right.display();
                    let folder = folder.trim_matches('/');
                    let path = match &left {
                        BaseValue::Text(path) | BaseValue::File { path, .. } => path.as_str(),
                        _ => return false,
                    };
                    if folder.is_empty() {
                        return true;
                    }
                    let parent = path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
                    parent == folder || parent.starts_with(&format!("{folder}/"))
                }
            }
        }
    }
}
struct ResultRow {
    doc: String,
    ctx: RowContext,
    /// Solo per calendario e linea del tempo.
    time: Option<RowTime>,
}

/// Un giorno civile come è scritto nella nota: anno, mese, giorno. L'ora e il
/// fuso della data non lo spostano.
type CivilDay = (i32, u8, u8);

/// Dove sta una riga nella vista di calendario o di linea del tempo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RowTime {
    /// Il calendario: il giorno della proprietà data, se la nota ce l'ha.
    Day(Option<CivilDay>),
    /// La linea del tempo: inizio e fine, se ci sono. Una fine prima
    /// dell'inizio si mostra e si segna.
    Span {
        start: Option<CivilDay>,
        end: Option<CivilDay>,
    },
}

impl RowTime {
    fn to_json(self) -> Value {
        match self {
            RowTime::Day(day) => json!({ "day": day.map(iso_day) }),
            RowTime::Span { start, end } => json!({
                "start": start.map(iso_day),
                "end": end.map(iso_day),
                "inverted": matches!((start, end), (Some(start), Some(end)) if end < start),
            }),
        }
    }
}

fn iso_day((year, month, day): CivilDay) -> String {
    format!("{year:04}-{month:02}-{day:02}")
}

/// Il giorno civile di una proprietà data. Una proprietà che non è una data,
/// o che manca, non ha giorno.
fn civil_day(value: Option<&PropertyValue>) -> Option<CivilDay> {
    match value? {
        PropertyValue::Date(date)
            if (1..=12).contains(&date.month) && (1..=31).contains(&date.day) =>
        {
            Some((date.year, date.month, date.day))
        }
        _ => None,
    }
}

/// Le proprietà che legge una vista di tempo, senza il prefisso `prop.`: la
/// data del calendario, o inizio e fine della linea del tempo. Le altre viste
/// non ne hanno.
fn time_keys(view: &BaseViewDef) -> (Option<&str>, Option<&str>, Option<&str>) {
    let Some(fub) = &view.fub else {
        return (None, None, None);
    };
    match view.view_type {
        ViewType::Calendar => (fub.date.as_deref().map(property_name), None, None),
        ViewType::Timeline => (
            None,
            fub.start.as_deref().map(property_name),
            fub.end.as_deref().map(property_name),
        ),
        _ => (None, None, None),
    }
}

fn property_name(key: &str) -> &str {
    key.strip_prefix("prop.").unwrap_or(key)
}

fn row_time(plan: &Planned<'_>, props: &BTreeMap<String, PropertyValue>) -> Option<RowTime> {
    let (date, start, end) = time_keys(plan.view);
    let prop = |key: Option<&str>| civil_day(key.and_then(|key| props.get(key)));
    match plan.view.view_type {
        ViewType::Calendar => Some(RowTime::Day(prop(date))),
        ViewType::Timeline => Some(RowTime::Span {
            start: prop(start),
            end: prop(end),
        }),
        _ => None,
    }
}
/// Il nome con cui un riepilogo esce da `derive`: il suo `name`, o la chiave
/// col tipo di aggregato (`score:sum`, `stato:countfilled`). Il piano lo dice
/// accanto a ogni riepilogo, perché la superficie metta il valore sotto la
/// sua colonna senza rifare la regola.
fn summary_label(summary: &SummaryDef) -> String {
    summary
        .name
        .clone()
        .unwrap_or_else(|| format!("{}:{:?}", summary.key, summary.aggregate).to_lowercase())
}

/// I riepiloghi scritti nella vista, come il modello li legge, ognuno col
/// nome con cui `derive` ne dà il valore (`label`).
fn summary_plan(view: &BaseViewDef) -> Vec<Value> {
    view.summaries
        .iter()
        .map(|summary| {
            json!({
                "key": summary.key,
                "aggregate": summary.aggregate,
                "expression": summary.expression,
                "name": summary.name,
                "label": summary_label(summary),
            })
        })
        .collect()
}

fn aggregate(kind: AggregateKind, values: &[BaseValue]) -> BaseValue {
    let filled: Vec<&BaseValue> = values.iter().filter(|value| !value.is_empty()).collect();
    match kind {
        AggregateKind::Count => BaseValue::Number(values.len() as f64),
        AggregateKind::CountFilled => BaseValue::Number(filled.len() as f64),
        AggregateKind::CountEmpty => BaseValue::Number((values.len() - filled.len()) as f64),
        AggregateKind::CountUnique => {
            let mut unique = BTreeSet::new();
            for value in filled {
                let Ok(serialized) = serde_json::to_string(value) else {
                    return BaseValue::Error(FormulaErrorCode::Value);
                };
                unique.insert(serialized);
            }
            BaseValue::Number(unique.len() as f64)
        }
        AggregateKind::Checked => BaseValue::Number(
            values
                .iter()
                .filter(|v| matches!(v, BaseValue::Bool(true)))
                .count() as f64,
        ),
        AggregateKind::Unchecked => BaseValue::Number(
            values
                .iter()
                .filter(|v| matches!(v, BaseValue::Bool(false)))
                .count() as f64,
        ),
        AggregateKind::Sum | AggregateKind::Average => {
            let numbers: Vec<f64> = filled
                .iter()
                .filter_map(|v| {
                    if let BaseValue::Number(n) = v {
                        Some(*n)
                    } else {
                        None
                    }
                })
                .collect();
            if numbers.len() != filled.len() {
                return BaseValue::Error(FormulaErrorCode::Value);
            }
            if numbers.is_empty() {
                return BaseValue::Empty;
            }
            let sum = numbers.iter().sum::<f64>();
            if !sum.is_finite() {
                return BaseValue::Error(FormulaErrorCode::Value);
            }
            if matches!(kind, AggregateKind::Average) {
                BaseValue::Number(sum / numbers.len() as f64)
            } else {
                BaseValue::Number(sum)
            }
        }
        AggregateKind::Min | AggregateKind::Max => {
            if filled
                .iter()
                .any(|value| !matches!(value, BaseValue::Number(_)))
            {
                return BaseValue::Error(FormulaErrorCode::Value);
            }
            let numbers = filled.into_iter();
            if matches!(kind, AggregateKind::Min) {
                numbers.min_by(|a, b| compare(a, b))
            } else {
                numbers.max_by(|a, b| compare(a, b))
            }
            .cloned()
            .unwrap_or(BaseValue::Empty)
        }
        AggregateKind::Earliest | AggregateKind::Latest => {
            if filled
                .iter()
                .any(|value| !matches!(value, BaseValue::Date(_)))
            {
                return BaseValue::Error(FormulaErrorCode::Value);
            }
            let dates = filled.into_iter();
            if matches!(kind, AggregateKind::Earliest) {
                dates.min_by(|a, b| compare(a, b))
            } else {
                dates.max_by(|a, b| compare(a, b))
            }
            .cloned()
            .unwrap_or(BaseValue::Empty)
        }
    }
}
fn derive(
    plan: &Planned<'_>,
    rows: Vec<InputRow>,
    now_ms: i64,
    container: Option<&str>,
    linked: Vec<InputLinked>,
) -> Result<Value, PluginError> {
    if rows.len() > MAX_BASE_ROWS_PER_CALL {
        return Err(bad("base: troppe righe per derivazione"));
    }
    required(plan)?;
    let linked = linked_notes(linked)?;
    let columns = columns(plan);
    let container_fields = container.map(file_fields).unwrap_or_default();
    let search = plan
        .view
        .search
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);
    let mut result = Vec::new();
    for input in rows {
        // Una Base elenca note, mai le definizioni delle Basi: il suo file
        // `.base` (e quello delle altre) non è una riga, qualunque filtro
        // abbia (IMP-1804).
        if is_base_definition(&input.doc) {
            continue;
        }
        let time = row_time(plan, &input.props);
        let days = civil_days(&input.props);
        let mut ctx = RowContext {
            props: input
                .props
                .iter()
                .map(|(k, v)| (k.clone(), property_value(v)))
                .collect(),
            file: file_fields(&input.doc),
            container: container_fields.clone(),
            formulas: BTreeMap::new(),
            now_ms,
            linked: linked.of_row(&input.doc),
        };
        for value in ctx.props.values() {
            check_intermediate(value)?;
        }
        let mut visiting = BTreeSet::new();
        let mut budget = EvalBudget::new(fub_format_base::formula::MAX_FORMULA_STEPS.min(5_000));
        for name in plan.formulas.keys() {
            evaluate_formula(name, plan, &mut ctx, &mut visiting, &mut budget);
        }
        for value in ctx.formulas.values() {
            check_intermediate(value)?;
        }
        if !matches_filter(&plan.definition.filters, &ctx, &days)
            || !matches_filter(&plan.view.filters, &ctx, &days)
        {
            continue;
        }
        if let Some(search) = &search {
            if !ctx
                .props
                .values()
                .chain(ctx.file.values())
                .chain(ctx.formulas.values())
                .any(|v| v.display().to_lowercase().contains(search))
            {
                continue;
            }
        }
        result.push(ResultRow {
            doc: input.doc,
            ctx,
            time,
        });
    }
    let mut summaries = BTreeMap::new();
    let mut summary_budget = EvalBudget::new(2_000_000);
    for summary in &plan.view.summaries {
        let expression = summary
            .expression
            .as_ref()
            .map(|source| Formula::parse(source));
        if let Some(Err(error)) = &expression {
            summaries.insert(summary_label(summary), BaseValue::Error(error.code()));
            continue;
        }
        let values = result
            .iter()
            .map(|row| match &expression {
                None => field(&summary.key, &row.ctx),
                Some(Err(error)) => BaseValue::Error(error.code()),
                Some(Ok(formula)) => formula.evaluate(&row.ctx, &mut summary_budget),
            })
            .collect::<Vec<_>>();
        let error = values.iter().find(|v| matches!(v, BaseValue::Error(_)));
        summaries.insert(
            summary_label(summary),
            error
                .cloned()
                .unwrap_or_else(|| aggregate(summary.aggregate, &values)),
        );
    }
    let mut keyed = result
        .into_iter()
        .map(|row| {
            let keys = plan
                .view
                .sort
                .iter()
                .map(|sort| SortKey::of(field(&sort.key, &row.ctx)))
                .collect::<Vec<_>>();
            (keys, row)
        })
        .collect::<Vec<_>>();
    keyed.sort_by(|(left_keys, a), (right_keys, b)| {
        for ((sort, left), right) in plan.view.sort.iter().zip(left_keys).zip(right_keys) {
            let order = match (&left.value, &right.value) {
                (BaseValue::Empty, BaseValue::Empty) => Ordering::Equal,
                (BaseValue::Empty, _) => Ordering::Greater,
                (_, BaseValue::Empty) => Ordering::Less,
                _ => {
                    let order = left.cmp(right);
                    if sort.descending {
                        order.reverse()
                    } else {
                        order
                    }
                }
            };
            if !order.is_eq() {
                return order;
            }
        }
        a.doc.cmp(&b.doc)
    });
    let mut result = keyed.into_iter().map(|(_, row)| row).collect::<Vec<_>>();
    if let Some(limit) = plan.view.limit {
        result.truncate(limit as usize);
    }
    let rows = result
        .into_iter()
        .map(|row| {
            let mut values = BTreeMap::new();
            for key in &columns {
                values.insert(key.clone(), field(key, &row.ctx));
            }
            if let Some(group) = &plan.view.group {
                values.insert(group.key.clone(), field(&group.key, &row.ctx));
            }
            if let Some(map) = &plan.view.map {
                for key in [&map.lat_key, &map.lon_key]
                    .into_iter()
                    .chain(map.label_key.iter())
                    .chain(map.color_key.iter())
                {
                    values.insert(key.clone(), field(key, &row.ctx));
                }
            }
            let mut out = json!({"doc":row.doc,"values":values});
            if let Some(time) = row.time {
                out["time"] = time.to_json();
            }
            out
        })
        .collect::<Vec<_>>();
    Ok(json!({"rows":rows,"summaries":summaries}))
}
fn respond(query: Value) -> Result<Value, PluginError> {
    check_json_size(&query, MAX_BASE_QUERY_BYTES, "query")?;
    let request: Request = serde_json::from_value(query)
        .map_err(|error| bad(format!("base: richiesta malformata: {error}")))?;
    if request.version != 1 {
        return Err(bad("base: versione query non supportata"));
    }
    let definition =
        BaseDefinition::parse(&request.source).map_err(|error| bad(format!("base: {error}")))?;
    match request.op.as_str() {
        // Con i nomi, il tipo di ogni vista nello stesso ordine: le linguette
        // della Base ne disegnano la figura anche quando non sono scelte.
        "parse" => Ok(json!({
            "views": definition.views.iter().map(|v| &v.name).collect::<Vec<_>>(),
            "types": definition.views.iter().map(|v| v.view_type).collect::<Vec<_>>(),
        })),
        "plan" => {
            let plan = planned(&definition, request.view.as_deref())?;
            let required_props = required(&plan)?;
            let view_type =
                serde_json::to_value(plan.view.view_type).map_err(|e| bad(e.to_string()))?;
            // Le proprietà di tempo che la vista legge: il piano le dice alla
            // superficie, che sceglie cosa mostrare se mancano.
            let (date_key, start_key, end_key) = time_keys(plan.view);
            // Le Relazioni dei riepiloghi e le proprietà delle note legate:
            // la superficie risolve quei link e le manda a `derive` in
            // `linked`.
            let (relations, linked_props) = rollup_deps(&plan);
            let labels: BTreeMap<_, _> = plan
                .definition
                .properties
                .iter()
                .filter_map(|property| {
                    property
                        .display_name
                        .as_ref()
                        .map(|name| (&property.key, name))
                })
                .collect();
            // Il filtro, l'ordinamento, le colonne scritte e i riepiloghi
            // della vista, come il modello li legge: la superficie li mostra
            // a vista e li riscrive con `base.view.set`, senza leggere il
            // YAML da sé. `order` è vuoto quando le colonne le deduce
            // `columns`.
            Ok(
                json!({"view":plan.view.name,"view_type":view_type,"columns":columns(&plan),"filters":plan.view.filters,"sort":plan.view.sort,"order":plan.view.order,"summaries":summary_plan(plan.view),"column_labels":labels,"required_props":required_props,"all_properties":plan.view.search.as_deref().is_some_and(|s| !s.is_empty()),"group":plan.view.group.as_ref().map(|g| &g.key),"limit":plan.view.limit,"map":plan.view.map,"date_key":date_key,"start_key":start_key,"end_key":end_key,"create_defaults":create_defaults(&plan.definition.filters, &plan.view.filters),"relations":relations,"linked_props":linked_props}),
            )
        }
        "derive" => derive(
            &planned(&definition, request.view.as_deref())?,
            request.rows,
            request.now_ms.ok_or_else(|| bad("base: ora mancante"))?,
            request.container.as_deref(),
            request.linked,
        ),
        "mutate" => {
            let plan = planned(&definition, request.view.as_deref())?;
            if request.edits.len() > MAX_BASE_ROWS_PER_CALL {
                return Err(bad("base: troppe mutazioni"));
            }
            let writable_columns = columns(&plan);
            // La data del calendario (e inizio e fine della linea del tempo)
            // si scrive anche se non è una colonna: trascinare una nota su un
            // giorno riscrive quella proprietà.
            let (date, start, end) = time_keys(plan.view);
            let time_keys = [date, start, end];
            let mut mutations = Vec::with_capacity(request.edits.len());
            for edit in request.edits {
                if edit.doc.is_empty()
                    || edit.key.is_empty()
                    || edit.key.starts_with("file.")
                    || edit.key.starts_with("formula.")
                    || (!writable_columns.contains(&edit.key)
                        && plan.view.group.as_ref().is_none_or(|g| g.key != edit.key)
                        && !time_keys.contains(&Some(edit.key.as_str())))
                {
                    return Err(bad("base: colonna non scrivibile"));
                }
                match edit.expected.get("kind").and_then(Value::as_str) {
                    Some("absent") if edit.expected.as_object().is_some_and(|m| m.len() == 1) => {}
                    Some("value") if edit.expected.as_object().is_some_and(|m| m.len() == 2) => {
                        serde_json::from_value::<PropertyValue>(edit.expected["value"].clone())
                            .map_err(|e| bad(format!("base: expected.value: {e}")))?;
                    }
                    _ => return Err(bad("base: expected tagged richiesto")),
                }
                let command = if edit.value.is_some() {
                    "note.property.set"
                } else {
                    "note.property.remove"
                };
                // Il comando scrive il nome del frontmatter (`prop.stato` è
                // la proprietà `stato`). La chiave di primo livello resta
                // quella della vista: il client la confronta con la richiesta.
                let mut args = json!({"doc":edit.doc,"key":property_name(&edit.key),"expected":serde_json::to_string(&edit.expected).map_err(|e| bad(e.to_string()))?});
                if let Some(value) = edit.value {
                    args["value"] = Value::String(value);
                }
                mutations
                    .push(json!({"doc":edit.doc,"key":edit.key,"command":command,"args":args}));
            }
            Ok(json!({"mutations":mutations}))
        }
        _ => Err(bad("base: operazione sconosciuta")),
    }
}
impl IndexProvider for BaseIndex {
    fn routes(&self) -> Vec<QueryRoute> {
        vec![QueryRoute::Query(QueryKind::Custom(BASE_ID.to_string()))]
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn on_documents_indexed(&mut self, _docs: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    /// Le basi si leggono dal loro file a ogni domanda, non da ciò che il
    /// kernel consegna: non c'è niente per documento che possa restare
    /// indietro.
    fn up_to_date(&self, entries: &[VaultEntry]) -> Vec<DocId> {
        // Niente può restare indietro in chi non tiene niente: ogni documento
        // mostrato, e solo quelli (conformità di `up_to_date`). Un indice che
        // tenesse stato per documento risponderebbe come `ReminderIndex`.
        entries
            .iter()
            .filter(|entry| entry.kind == fub_abi::traits::EntryKind::Document)
            .map(|entry| entry.id.clone())
            .collect()
    }
    fn query(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            IndexQuery::Custom { ns, query } if ns == BASE_ID => {
                let response = respond(query)?;
                check_json_size(&response, MAX_BASE_RESPONSE_BYTES, "risposta")?;
                Ok(IndexResult::Custom(response))
            }
            _ => Err(PluginError::Unserved(Text::from(
                "base: rotta non dichiarata",
            ))),
        }
    }
}

// ---------------------------------------------------------------------------
// I comandi che scrivono un `.base`: una chiave di una vista, una vista in più,
// una vista in meno. Il testo lo cambia la toppa di `fub-format-base`, che dice
// anche quando non si può scrivere; qui si chiede la revisione, si applica con
// il controllo di base dell'host e l'annulla è l'inverso che l'host restituisce.
// ---------------------------------------------------------------------------

/// Scrive una chiave di una vista. Senza `value` (o con `null`) la toglie.
pub const BASE_VIEW_SET: &str = "base.view.set";
/// Aggiunge in fondo a un `.base` una vista con nome e tipo.
pub const BASE_VIEW_ADD: &str = "base.view.add";
/// Toglie una vista con tutte le sue chiavi.
pub const BASE_VIEW_REMOVE: &str = "base.view.remove";

const DOC: &str = "doc";
const VIEW: &str = "view";
const KEY: &str = "key";
const VALUE: &str = "value";
const NAME: &str = "name";
const TYPE: &str = "type";
const BASE: &str = "base";
const LINE: &str = "line";
const LIMIT: &str = "limit";

const P_SET: &str = "base.view.p_set";
const P_ADD: &str = "base.view.p_add";
const P_REMOVE: &str = "base.view.p_remove";
const N_SET: &str = "base.view.n_set";
const N_ADD: &str = "base.view.n_add";
const N_REMOVE: &str = "base.view.n_remove";
const N_UNCHANGED: &str = "base.view.n_unchanged";
const U_SET: &str = "base.view.u_set";
const U_ADD: &str = "base.view.u_add";
const U_REMOVE: &str = "base.view.u_remove";
const E_NO_DOC: &str = "base.view.e_no_doc";
const E_MISSING: &str = "base.view.e_missing";
const E_NOT_BASE: &str = "base.view.e_not_base";
const E_BASE_CHANGED: &str = "base.view.e_base_changed";
const E_UNKNOWN_KEY: &str = "base.view.e_unknown_key";
const E_VALUE_JSON: &str = "base.view.e_value_json";
const E_BAD_VALUE: &str = "base.view.e_bad_value";
const E_NOT_FOR_VIEW: &str = "base.view.e_not_for_view";
const E_UNREADABLE: &str = "base.view.e_unreadable";
const E_LIMIT_BYTES: &str = "base.view.e_limit_bytes";
const E_LIMIT_VIEWS: &str = "base.view.e_limit_views";
const E_INVALID: &str = "base.view.e_invalid";
const E_NO_VIEW: &str = "base.view.e_no_view";
const E_DUPLICATE: &str = "base.view.e_duplicate";
const E_REQUIRED: &str = "base.view.e_required";
const E_FLOW_KEY: &str = "base.view.e_flow_key";
const E_FLOW_VIEW: &str = "base.view.e_flow_view";
const E_FLOW_VIEWS: &str = "base.view.e_flow_views";
const E_UNSAFE: &str = "base.view.e_unsafe";
const E_VERIFY: &str = "base.view.e_verify";

/// Le frasi di un gesto: il piano che si vede prima, l'esito, la voce
/// dell'annulla.
struct Phrases {
    plan: Text,
    done: Text,
    undo: Text,
}

/// I comandi che scrivono un `.base`.
pub struct BaseCommands;

impl CommandProvider for BaseCommands {
    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec::new(BASE_VIEW_SET, Text::key(format!("{BASE_VIEW_SET}.title")))
                .describing(Text::key(format!("{BASE_VIEW_SET}.desc")))
                .with_param(parameter(BASE_VIEW_SET, DOC, ParamKind::Document).required())
                .with_param(parameter(BASE_VIEW_SET, VIEW, ParamKind::Text).required())
                .with_param(parameter(BASE_VIEW_SET, KEY, ParamKind::Text).required())
                .with_param(parameter(BASE_VIEW_SET, VALUE, ParamKind::Text))
                .with_param(parameter(BASE_VIEW_SET, BASE, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(BASE_VIEW_ADD, Text::key(format!("{BASE_VIEW_ADD}.title")))
                .describing(Text::key(format!("{BASE_VIEW_ADD}.desc")))
                .with_param(parameter(BASE_VIEW_ADD, DOC, ParamKind::Document).required())
                .with_param(parameter(BASE_VIEW_ADD, NAME, ParamKind::Text).required())
                .with_param(parameter(BASE_VIEW_ADD, TYPE, ParamKind::Text))
                .with_param(parameter(BASE_VIEW_ADD, BASE, ParamKind::Text))
                .with_scope(CommandScope::writing(CommandReach::Document)),
            CommandSpec::new(
                BASE_VIEW_REMOVE,
                Text::key(format!("{BASE_VIEW_REMOVE}.title")),
            )
            .describing(Text::key(format!("{BASE_VIEW_REMOVE}.desc")))
            .with_param(parameter(BASE_VIEW_REMOVE, DOC, ParamKind::Document).required())
            .with_param(parameter(BASE_VIEW_REMOVE, VIEW, ParamKind::Text).required())
            .with_param(parameter(BASE_VIEW_REMOVE, BASE, ParamKind::Text))
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
        let args = Args::new(&args);
        match command {
            BASE_VIEW_SET => view_set(args, mode, host),
            BASE_VIEW_ADD => view_add(args, mode, host),
            BASE_VIEW_REMOVE => view_remove(args, mode, host),
            other => Err(PluginError::UnknownCommand(other.to_string().into())),
        }
    }
}

fn parameter(command: &str, name: &str, kind: ParamKind) -> ParamSpec {
    ParamSpec::new(name, Text::key(format!("{command}.{name}.title")), kind)
        .describing(Text::key(format!("{command}.{name}.desc")))
}

fn view_set(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_arg(args, host)?;
    let view = text_arg(args, VIEW)?;
    let key = key_arg(args)?;
    let value = match args.text(VALUE) {
        None => None,
        Some(raw) => match serde_json::from_str::<Value>(raw) {
            Ok(Value::Null) => None,
            Ok(value) => Some(value),
            Err(_) => return Err(PluginError::BadArgs(Text::key(E_VALUE_JSON))),
        },
    };
    let change = BaseChange::SetKey {
        view: view.to_string(),
        key,
        value,
    };
    let phrases = set_phrases(&doc, view, key);
    write(&doc, change, args, mode, host, phrases)
}

fn view_add(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_arg(args, host)?;
    let name = text_arg(args, NAME)?;
    let view_type = match args.text(TYPE) {
        None => ViewType::Table,
        Some(raw) => {
            serde_json::from_value::<ViewType>(Value::String(raw.to_string())).map_err(|_| {
                PluginError::BadArgs(Text::message(E_BAD_VALUE, vec![Arg::text(KEY, TYPE)]))
            })?
        }
    };
    let change = BaseChange::AddView {
        name: name.to_string(),
        view_type,
    };
    let phrases = add_phrases(&doc, name);
    write(&doc, change, args, mode, host, phrases)
}

fn view_remove(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = doc_arg(args, host)?;
    let view = text_arg(args, VIEW)?;
    let change = BaseChange::RemoveView {
        view: view.to_string(),
    };
    let phrases = remove_phrases(&doc, view);
    write(&doc, change, args, mode, host, phrases)
}

/// Calcola la modifica sul testo letto e la applica, o ne dà il piano. Se il
/// chiamante dice una revisione, il file deve ancora essere quella; e l'host
/// applica la modifica solo se la sua base combacia ancora col file, così una
/// scrittura nel frattempo fa fallire il comando invece di sparire.
fn write(
    doc: &DocId,
    change: BaseChange,
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
    phrases: Phrases,
) -> Result<CommandOutcome, PluginError> {
    if !is_base(host, doc) {
        return Err(PluginError::BadArgs(about(E_NOT_BASE, doc, Vec::new())));
    }
    let revision = host.document_revision(doc)?;
    if let Some(base) = args.text(BASE) {
        if Revision::new(base) != revision {
            return Err(PluginError::Conflict(about(
                E_BASE_CHANGED,
                doc,
                Vec::new(),
            )));
        }
    }
    let source = host.read_document(doc)?;
    let edits = patch::apply(&source, &change).map_err(|error| patch_failure(doc, error))?;
    if edits.is_empty() {
        return Ok(if mode.is_dry_run() {
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                phrases.plan,
                Vec::new(),
            )))
        } else {
            CommandOutcome::notify(about(N_UNCHANGED, doc, Vec::new()))
        });
    }
    let request = EditRequest::new(revision, edits);
    if mode.is_dry_run() {
        return Ok(
            CommandOutcome::done().with_effect(CommandEffect::Plan(CommandPlan::of_edits(
                phrases.plan,
                vec![PlannedEdit::new(doc.clone(), request)],
            ))),
        );
    }
    let report = host.apply_edit(doc, request)?;
    let undo = Undo::of_edits(
        phrases.undo,
        vec![PlannedEdit::new(doc.clone(), report.inverse())],
    );
    Ok(CommandOutcome::notify(phrases.done)
        .undoable(undo)
        .with_effect(CommandEffect::Custom {
            ns: BASE_ID.into(),
            payload: json!({ "revision": report.revision.0 }),
        }))
}

/// Il motivo di un rifiuto della toppa, nelle frasi del comando. Nessun
/// rifiuto scrive: la toppa non ha prodotto niente da applicare.
fn patch_failure(doc: &DocId, error: PatchError) -> PluginError {
    match error {
        PatchError::Unreadable => PluginError::BadArgs(about(E_UNREADABLE, doc, Vec::new())),
        PatchError::Model(BaseError::Limit {
            what: "source bytes",
            limit,
        }) => PluginError::BadArgs(about(
            E_LIMIT_BYTES,
            doc,
            vec![Arg::int(LIMIT, limit as i64)],
        )),
        PatchError::Model(BaseError::Limit {
            what: "views",
            limit,
        }) => PluginError::BadArgs(about(
            E_LIMIT_VIEWS,
            doc,
            vec![Arg::int(LIMIT, limit as i64)],
        )),
        PatchError::Model(_) => PluginError::BadArgs(about(E_INVALID, doc, Vec::new())),
        PatchError::NoView(view) => {
            PluginError::BadArgs(about(E_NO_VIEW, doc, vec![Arg::text(VIEW, view)]))
        }
        PatchError::DuplicateView(view) => {
            PluginError::BadArgs(about(E_DUPLICATE, doc, vec![Arg::text(VIEW, view)]))
        }
        PatchError::RequiredKey(key) => PluginError::BadArgs(Text::message(
            E_REQUIRED,
            vec![Arg::text(KEY, key.as_str())],
        )),
        PatchError::BadValue(key) => PluginError::BadArgs(Text::message(
            E_BAD_VALUE,
            vec![Arg::text(KEY, key.as_str())],
        )),
        PatchError::NotForView(key) => PluginError::BadArgs(Text::message(
            E_NOT_FOR_VIEW,
            vec![Arg::text(KEY, key.as_str())],
        )),
        PatchError::Unsafe { line, .. } => {
            PluginError::BadArgs(about(E_UNSAFE, doc, vec![Arg::int(LINE, line as i64)]))
        }
        PatchError::Flow { place } => match place {
            Place::Key(key) => {
                PluginError::BadArgs(about(E_FLOW_KEY, doc, vec![Arg::text(KEY, key.as_str())]))
            }
            Place::View => PluginError::BadArgs(about(E_FLOW_VIEW, doc, Vec::new())),
            Place::Views => PluginError::BadArgs(about(E_FLOW_VIEWS, doc, Vec::new())),
        },
        PatchError::Verify => PluginError::BadArgs(about(E_VERIFY, doc, Vec::new())),
    }
}

/// Il `.base` del comando: scelto dall'elenco o scritto per nome, fra i soli
/// documenti del formato `.base`.
fn doc_arg(args: Args<'_>, host: &dyn HostApi) -> Result<DocId, PluginError> {
    crate::formats::document_named_by(&args, DOC, host, |doc| is_base(host, doc))?
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_NO_DOC)))
}

/// Il documento è un `.base`? Lo dice il formato che lo serve, non l'estensione.
fn is_base(host: &dyn HostApi, doc: &DocId) -> bool {
    host.format_of(doc)
        .is_some_and(|format| format.descriptor.id == BASE_FORMAT_ID)
}

fn text_arg<'a>(args: Args<'a>, name: &str) -> Result<&'a str, PluginError> {
    args.text(name)
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_MISSING)))
}

fn key_arg(args: Args<'_>) -> Result<ViewKey, PluginError> {
    let raw = text_arg(args, KEY)?;
    ViewKey::parse(raw).ok_or_else(|| {
        PluginError::BadArgs(Text::message(E_UNKNOWN_KEY, vec![Arg::text(KEY, raw)]))
    })
}

/// Una frase che nomina il file, più altri argomenti.
fn about(key: &str, doc: &DocId, mut args: Vec<Arg>) -> Text {
    args.insert(0, Arg::text(DOC, doc.as_str()));
    Text::message(key, args)
}

fn set_phrases(doc: &DocId, view: &str, key: ViewKey) -> Phrases {
    let named = || vec![Arg::text(VIEW, view), Arg::text(KEY, key.as_str())];
    Phrases {
        plan: about(P_SET, doc, named()),
        done: about(N_SET, doc, vec![Arg::text(VIEW, view)]),
        undo: about(U_SET, doc, named()),
    }
}

fn add_phrases(doc: &DocId, name: &str) -> Phrases {
    Phrases {
        plan: about(P_ADD, doc, vec![Arg::text(VIEW, name)]),
        done: about(N_ADD, doc, vec![Arg::text(VIEW, name)]),
        undo: about(U_ADD, doc, vec![Arg::text(VIEW, name)]),
    }
}

fn remove_phrases(doc: &DocId, view: &str) -> Phrases {
    Phrases {
        plan: about(P_REMOVE, doc, vec![Arg::text(VIEW, view)]),
        done: about(N_REMOVE, doc, vec![Arg::text(VIEW, view)]),
        undo: about(U_REMOVE, doc, vec![Arg::text(VIEW, view)]),
    }
}

/// Le frasi dei comandi di Base, in italiano e in inglese: chiave, italiano,
/// inglese. Si aggiungono a quelle del blocco (`embed_catalog`).
const STRINGS: &[(&str, &str, &str)] = &[
    (
        "base.view.set.title",
        "Scrivi una chiave di vista",
        "Write a view key",
    ),
    (
        "base.view.set.desc",
        "Cambia una chiave di una vista di un file .base (filtro, ordine, colonne, raggruppamento, riepiloghi, nome, tipo) e lascia com'è il resto del file. Senza valore la toglie. Si annulla in un passo.",
        "Changes a key of a view of a .base file (filter, order, columns, grouping, summaries, name, type) and leaves the rest of the file as it is. Without a value it removes the key. Undone in one step.",
    ),
    ("base.view.set.doc.title", "File .base", "The .base file"),
    (
        "base.view.set.doc.desc",
        "Il file .base da cambiare.",
        "The .base file to change.",
    ),
    ("base.view.set.view.title", "Vista", "View"),
    (
        "base.view.set.view.desc",
        "Il nome della vista da cambiare.",
        "The name of the view to change.",
    ),
    ("base.view.set.key.title", "Chiave", "Key"),
    (
        "base.view.set.key.desc",
        "Una fra: name, type, order, filters, sort, group, summaries, limit, search, map, date, start, end.",
        "One of: name, type, order, filters, sort, group, summaries, limit, search, map, date, start, end.",
    ),
    ("base.view.set.value.title", "Valore", "Value"),
    (
        "base.view.set.value.desc",
        "Il valore in JSON, nella forma del modello. Assente o null toglie la chiave.",
        "The value in JSON, in the form of the model. Absent or null removes the key.",
    ),
    ("base.view.set.base.title", "Revisione di partenza", "Base revision"),
    (
        "base.view.set.base.desc",
        "Se c'è, la scrittura vale solo per questa revisione del file.",
        "If given, the write applies only to this revision of the file.",
    ),
    (
        "base.view.add.title",
        "Aggiungi una vista",
        "Add a view",
    ),
    (
        "base.view.add.desc",
        "Aggiunge in fondo a un file .base una vista con nome e tipo; le altre chiavi si scrivono dopo. Si annulla in un passo.",
        "Adds a view with a name and a type at the end of a .base file; the other keys are written after. Undone in one step.",
    ),
    ("base.view.add.doc.title", "File .base", "The .base file"),
    (
        "base.view.add.doc.desc",
        "Il file .base in cui aggiungere la vista.",
        "The .base file to add the view to.",
    ),
    ("base.view.add.name.title", "Nome", "Name"),
    (
        "base.view.add.name.desc",
        "Il nome della nuova vista: non deve esistere già nel file.",
        "The name of the new view: it must not already exist in the file.",
    ),
    ("base.view.add.type.title", "Tipo", "Type"),
    (
        "base.view.add.type.desc",
        "Il tipo: table, cards, list, kanban, map, calendar o timeline. Assente = table.",
        "The type: table, cards, list, kanban, map, calendar or timeline. Absent = table.",
    ),
    ("base.view.add.base.title", "Revisione di partenza", "Base revision"),
    (
        "base.view.add.base.desc",
        "Se c'è, la scrittura vale solo per questa revisione del file.",
        "If given, the write applies only to this revision of the file.",
    ),
    (
        "base.view.remove.title",
        "Togli una vista",
        "Remove a view",
    ),
    (
        "base.view.remove.desc",
        "Toglie una vista con tutte le sue chiavi da un file .base. Gli altri byte del file restano com'erano. Si annulla in un passo.",
        "Removes a view with all its keys from a .base file. The other bytes of the file stay as they were. Undone in one step.",
    ),
    ("base.view.remove.doc.title", "File .base", "The .base file"),
    (
        "base.view.remove.doc.desc",
        "Il file .base da cui togliere la vista.",
        "The .base file to remove the view from.",
    ),
    ("base.view.remove.view.title", "Vista", "View"),
    (
        "base.view.remove.view.desc",
        "Il nome della vista da togliere.",
        "The name of the view to remove.",
    ),
    ("base.view.remove.base.title", "Revisione di partenza", "Base revision"),
    (
        "base.view.remove.base.desc",
        "Se c'è, la scrittura vale solo per questa revisione del file.",
        "If given, the write applies only to this revision of the file.",
    ),
    (
        P_SET,
        "Imposta «{key}» nella vista «{view}» di {doc}",
        "Set «{key}» in the view «{view}» of {doc}",
    ),
    (
        P_ADD,
        "Aggiunge la vista «{view}» a {doc}",
        "Add the view «{view}» to {doc}",
    ),
    (
        P_REMOVE,
        "Toglie la vista «{view}» da {doc}",
        "Remove the view «{view}» from {doc}",
    ),
    (
        N_SET,
        "Vista «{view}» di {doc} aggiornata.",
        "View «{view}» of {doc} updated.",
    ),
    (
        N_ADD,
        "Vista «{view}» aggiunta a {doc}.",
        "View «{view}» added to {doc}.",
    ),
    (
        N_REMOVE,
        "Vista «{view}» tolta da {doc}.",
        "View «{view}» removed from {doc}.",
    ),
    (
        N_UNCHANGED,
        "{doc} è già così: non cambia.",
        "{doc} already is like this: it does not change.",
    ),
    (
        U_SET,
        "la chiave «{key}» della vista «{view}» di {doc}",
        "the key «{key}» of the view «{view}» of {doc}",
    ),
    (
        U_ADD,
        "la vista «{view}» aggiunta a {doc}",
        "the view «{view}» added to {doc}",
    ),
    (
        U_REMOVE,
        "la vista «{view}» tolta da {doc}",
        "the view «{view}» removed from {doc}",
    ),
    (
        E_NO_DOC,
        "Nessun file .base indicato.",
        "No .base file given.",
    ),
    (
        E_MISSING,
        "Manca un argomento obbligatorio.",
        "A required argument is missing.",
    ),
    (
        E_NOT_BASE,
        "{doc} non è un file .base.",
        "{doc} is not a .base file.",
    ),
    (
        E_BASE_CHANGED,
        "{doc} è cambiato dalla revisione indicata: rileggilo e riprova.",
        "{doc} changed since the given revision: read it again and retry.",
    ),
    (
        E_UNKNOWN_KEY,
        "«{key}» non è una chiave di vista che si può scrivere.",
        "\"{key}\" is not a view key that can be written.",
    ),
    (
        E_VALUE_JSON,
        "Il valore non è JSON valido.",
        "The value is not valid JSON.",
    ),
    (
        E_BAD_VALUE,
        "Il valore non va bene per la chiave «{key}».",
        "The value does not fit the key «{key}».",
    ),
    (
        E_NOT_FOR_VIEW,
        "La chiave «{key}» non va in questo tipo di vista.",
        "The key «{key}» does not belong to this kind of view.",
    ),
    (
        E_UNREADABLE,
        "{doc} non si legge come Base: non lo cambio.",
        "{doc} does not read as a Base: it is not changed.",
    ),
    (
        E_LIMIT_BYTES,
        "{doc} è più grande del limite di {limit} byte: non lo cambio.",
        "{doc} is larger than the limit of {limit} bytes: it is not changed.",
    ),
    (
        E_LIMIT_VIEWS,
        "{doc} ha più viste del limite di {limit}.",
        "{doc} has more views than the limit of {limit}.",
    ),
    (
        E_INVALID,
        "Dopo la modifica {doc} non sarebbe una Base valida: non la scrivo.",
        "After the change {doc} would not be a valid Base: it is not written.",
    ),
    (
        E_NO_VIEW,
        "In {doc} non c'è la vista «{view}».",
        "In {doc} there is no view «{view}».",
    ),
    (
        E_DUPLICATE,
        "In {doc} c'è già una vista chiamata «{view}».",
        "In {doc} there is already a view called «{view}».",
    ),
    (
        E_REQUIRED,
        "La chiave «{key}» non si può togliere: ogni vista ce l'ha.",
        "The key «{key}» cannot be removed: every view has it.",
    ),
    (
        E_FLOW_KEY,
        "In {doc} la chiave «{key}» è scritta in YAML di flusso: non la riscrivo, cambiala dal sorgente.",
        "In {doc} the key «{key}» is written as flow YAML: it is not rewritten, change it in the source.",
    ),
    (
        E_FLOW_VIEW,
        "In {doc} la vista è scritta in YAML di flusso: non la riscrivo, cambiala dal sorgente.",
        "In {doc} the view is written as flow YAML: it is not rewritten, change it in the source.",
    ),
    (
        E_FLOW_VIEWS,
        "In {doc} la lista delle viste è in YAML di flusso: non la riscrivo, cambiala dal sorgente.",
        "In {doc} the list of views is flow YAML: it is not rewritten, change it in the source.",
    ),
    (
        E_UNSAFE,
        "{doc}, riga {line}: c'è una forma che non so cambiare senza riscrivere il file: non lo cambio.",
        "{doc}, line {line}: there is a form that cannot be changed without rewriting the file: it is not changed.",
    ),
    (
        E_VERIFY,
        "La modifica di {doc} non darebbe il file atteso: non l'ho scritta.",
        "The change to {doc} would not give the expected file: it was not written.",
    ),
];

/// Le stringhe del componente: quelle del blocco e quelle dei comandi.
pub fn catalog() -> Vec<StringCatalog> {
    let mut catalogs = fub_format_base::embed_catalog();
    for catalog in &mut catalogs {
        for (key, italiano, english) in STRINGS {
            let template = match catalog.locale.as_str() {
                "it" => italiano,
                "en" => english,
                _ => continue,
            };
            catalog
                .entries
                .insert((*key).to_string(), (*template).to_string());
        }
    }
    // I comandi leggono il campo «Documento» con le frasi comuni del nome
    // scritto ([`crate::formats::document_named_by`]).
    crate::formats::speaking(catalogs)
}

#[cfg(test)]
mod tests;
