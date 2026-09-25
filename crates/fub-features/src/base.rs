//! Stateless `.base` query provider. Document selection remains `Documents` in
//! the generic index registry; this provider plans and evaluates a definition.
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use fub_abi::error::PluginError;
use fub_abi::model::{LinkTarget, PropertyDate, PropertyScalar, PropertyValue};
use fub_abi::text::Text;
use fub_abi::traits::{
    HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryKind, QueryRoute,
};
use fub_abi::{DocId, DocumentModel};
use fub_format_base::formula::{BaseValue, EvalBudget, Formula, FormulaErrorCode, RowContext};
use fub_format_base::model::FilterOp;
use fub_format_base::{AggregateKind, BaseDefinition, BaseViewDef, FilterDef};
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
}
#[derive(Deserialize)]
struct InputRow {
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
fn contains(left: &BaseValue, right: &BaseValue) -> bool {
    match (left, right) {
        (BaseValue::Text(text), BaseValue::Text(needle)) => text.contains(needle),
        (BaseValue::List(items), wanted) => items.contains(wanted),
        _ => left == right,
    }
}
fn matches_filter(filter: &FilterDef, ctx: &RowContext) -> bool {
    match filter {
        FilterDef::All => true,
        FilterDef::And(parts) => parts.iter().all(|part| matches_filter(part, ctx)),
        FilterDef::Or(parts) => parts.iter().any(|part| matches_filter(part, ctx)),
        FilterDef::Not(part) => !matches_filter(part, ctx),
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
            if matches!(left, BaseValue::Error(_)) {
                return false;
            }
            let right = tag
                .as_ref()
                .map(|s| BaseValue::Text(s.clone()))
                .unwrap_or_else(|| json_value(value));
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
) -> Result<Value, PluginError> {
    if rows.len() > MAX_BASE_ROWS_PER_CALL {
        return Err(bad("base: troppe righe per derivazione"));
    }
    required(plan)?;
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
        if !matches_filter(&plan.definition.filters, &ctx)
            || !matches_filter(&plan.view.filters, &ctx)
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
            let label = summary.name.clone().unwrap_or_else(|| {
                format!("{}:{:?}", summary.key, summary.aggregate).to_lowercase()
            });
            summaries.insert(label, BaseValue::Error(error.code()));
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
        let label = summary
            .name
            .clone()
            .unwrap_or_else(|| format!("{}:{:?}", summary.key, summary.aggregate).to_lowercase());
        summaries.insert(
            label,
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
            json!({"doc":row.doc,"values":values})
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
        "parse" => {
            Ok(json!({"views": definition.views.iter().map(|v| &v.name).collect::<Vec<_>>()}))
        }
        "plan" => {
            let plan = planned(&definition, request.view.as_deref())?;
            let required_props = required(&plan)?;
            let view_type =
                serde_json::to_value(plan.view.view_type).map_err(|e| bad(e.to_string()))?;
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
            Ok(
                json!({"view":plan.view.name,"view_type":view_type,"columns":columns(&plan),"column_labels":labels,"required_props":required_props,"all_properties":plan.view.search.as_deref().is_some_and(|s| !s.is_empty()),"group":plan.view.group.as_ref().map(|g| &g.key),"limit":plan.view.limit,"map":plan.view.map,"create_defaults":create_defaults(&plan.definition.filters, &plan.view.filters)}),
            )
        }
        "derive" => derive(
            &planned(&definition, request.view.as_deref())?,
            request.rows,
            request.now_ms.ok_or_else(|| bad("base: ora mancante"))?,
            request.container.as_deref(),
        ),
        "mutate" => {
            let plan = planned(&definition, request.view.as_deref())?;
            if request.edits.len() > MAX_BASE_ROWS_PER_CALL {
                return Err(bad("base: troppe mutazioni"));
            }
            let writable_columns = columns(&plan);
            let mut mutations = Vec::with_capacity(request.edits.len());
            for edit in request.edits {
                if edit.doc.is_empty()
                    || edit.key.is_empty()
                    || edit.key.starts_with("file.")
                    || edit.key.starts_with("formula.")
                    || (!writable_columns.contains(&edit.key)
                        && plan.view.group.as_ref().is_none_or(|g| g.key != edit.key))
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
                let mut args = json!({"doc":edit.doc,"key":edit.key,"expected":serde_json::to_string(&edit.expected).map_err(|e| bad(e.to_string()))?});
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

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = "properties:\n  - {key: status}\nviews:\n  - name: Board\n    type: kanban\n    order: [status]\n    group: {key: status}\n    sort: [{key: score, descending: true}]\n    summaries: [{key: score, aggregate: sum}]\n";

    #[test]
    fn sort_keys_order_like_the_values() {
        let values = [
            BaseValue::Empty,
            BaseValue::Number(2.5),
            BaseValue::Number(-1.0),
            BaseValue::Number(f64::NAN),
            BaseValue::Text("b".into()),
            BaseValue::Text("ab".into()),
            BaseValue::Text(String::new()),
            BaseValue::Bool(true),
            BaseValue::Bool(false),
            BaseValue::Date(20),
            BaseValue::Date(3),
            BaseValue::Duration(100),
            BaseValue::List(vec![BaseValue::Number(1.0), BaseValue::Text("x".into())]),
            BaseValue::List(Vec::new()),
            BaseValue::Object(BTreeMap::from([("k".into(), BaseValue::Bool(true))])),
            BaseValue::File {
                path: "b.md".into(),
                label: None,
            },
            BaseValue::Link {
                target: "a.md".into(),
                label: Some("z".into()),
            },
            BaseValue::Error(FormulaErrorCode::DivZero),
            BaseValue::Error(FormulaErrorCode::Name),
        ];
        for left in &values {
            for right in &values {
                let keys = SortKey::of(left.clone()).cmp(&SortKey::of(right.clone()));
                assert_eq!(keys, compare(left, right), "{left:?} ~ {right:?}");
            }
        }
    }

    #[test]
    fn plan_includes_hidden_sort_and_summary_dependencies() {
        let plan =
            respond(json!({"version":1,"op":"plan","source":SOURCE,"view":"Board"})).unwrap();
        assert_eq!(plan["view_type"], "kanban");
        assert_eq!(plan["required_props"], json!(["score", "status"]));
    }

    #[test]
    fn typed_rows_sort_and_summarize_before_view_limit() {
        let source = SOURCE.replace("    sort:", "    limit: 1\n    sort:");
        let derived = respond(json!({"version":1,"op":"derive","source":source,"view":"Board","now_ms":0,"rows":[
            {"doc":"a.md","props":{"status":{"kind":"empty"},"score":{"kind":"number","value":1}}},
            {"doc":"b.md","props":{"status":{"kind":"bool","value":false},"score":{"kind":"number","value":2}}}
        ]})).unwrap();
        assert_eq!(derived["rows"].as_array().unwrap().len(), 1);
        assert_eq!(derived["rows"][0]["doc"], "b.md");
        assert_eq!(
            derived["rows"][0]["values"]["status"],
            json!({"kind":"bool","value":false})
        );
        assert_eq!(
            derived["summaries"]["score:sum"],
            json!({"kind":"number","value":3.0})
        );
    }

    #[test]
    fn query_never_clips_results_at_a_page_boundary() {
        let rows = (0..2001)
            .map(|index| json!({"doc":format!("{index:04}.md"),"props":{}}))
            .collect::<Vec<_>>();
        let derived = respond(json!({"version":1,"op":"derive","source":SOURCE,"view":"Board","now_ms":0,"rows":rows})).unwrap();
        assert_eq!(derived["rows"].as_array().unwrap().len(), 2001);
    }
    #[test]
    fn heterogeneous_comparisons_do_not_turn_numbers_into_text() {
        let source = "filters:\n  condition: {property: score, op: greater_than, value: '2'}\nviews:\n  - {name: Filtered, type: table, order: [score]}\n";
        let derived = respond(
            json!({"version":1,"op":"derive","source":source,"view":"Filtered","now_ms":0,"rows":[
                {"doc":"number.md","props":{"score":{"kind":"number","value":10}}},
                {"doc":"text.md","props":{"score":{"kind":"text","value":"3"}}}
            ]}),
        )
        .unwrap();
        assert_eq!(derived["rows"].as_array().unwrap().len(), 1);
        assert_eq!(derived["rows"][0]["doc"], "text.md");
    }

    #[test]
    fn budgets_fail_instead_of_returning_a_partial_answer() {
        let oversized = json!({"version":1,"op":"parse","source":"x".repeat(MAX_BASE_QUERY_BYTES)});
        assert!(matches!(respond(oversized), Err(PluginError::BadArgs(_))));
        assert!(matches!(
            check_json_size(&json!("long answer"), 4, "risposta"),
            Err(PluginError::BadArgs(_))
        ));
        let definition = BaseDefinition::parse(SOURCE).unwrap();
        let plan = planned(&definition, Some("Board")).unwrap();
        let rows = (0..=MAX_BASE_ROWS_PER_CALL)
            .map(|index| InputRow {
                doc: format!("{index}.md"),
                props: BTreeMap::new(),
            })
            .collect();
        assert!(matches!(
            derive(&plan, rows, 0, None),
            Err(PluginError::BadArgs(_))
        ));
    }
    #[test]
    fn container_context_and_custom_summary_are_identical_for_embeds_and_standalone() {
        let source = "formulas:\n  - {name: host, expression: 'container.folder'}\n  - {name: doubled, expression: 'prop.score * 2'}\nviews:\n  - name: Board\n    type: table\n    order: [formula.host, formula.doubled]\n    limit: 1\n    summaries:\n      - {name: Total, key: score, aggregate: sum, expression: 'prop.score * 2'}\n";
        let input = json!({"version":1,"op":"derive","source":source,"view":"Board","container":"Projects/host.md","now_ms":0,"rows":[
            {"doc":"a.md","props":{"score":{"kind":"number","value":2}}},
            {"doc":"b.md","props":{"score":{"kind":"number","value":3}}}
        ]});
        let embedded = respond(input.clone()).unwrap();
        let standalone = respond(input).unwrap();
        assert_eq!(embedded, standalone);
        assert_eq!(
            embedded["rows"][0]["values"]["formula.host"],
            json!({"kind":"text","value":"Projects"})
        );
        assert_eq!(
            embedded["summaries"]["Total"],
            json!({"kind":"number","value":10.0})
        );
        let plan =
            respond(json!({"version":1,"op":"plan","source":source,"view":"Board"})).unwrap();
        assert_eq!(plan["required_props"], json!(["score"]));
    }

    #[test]
    fn defaults_only_include_entailed_equalities_and_cycles_stay_errors() {
        let source = "filters:\n  condition: {property: status, op: is, value: ready}\nformulas:\n  - {name: a, expression: 'formula.b + 1'}\n  - {name: b, expression: 'formula.a + 1'}\nviews:\n  - name: Board\n    type: table\n    order: [formula.a]\n    filters:\n      and:\n        - condition: {property: priority, op: is, value: 2}\n        - or:\n            - condition: {property: lane, op: is, value: Done}\n            - condition: {property: lane, op: is, value: Todo}\n";
        let plan = respond(json!({"version":1,"op":"plan","source":source})).unwrap();
        assert_eq!(
            plan["create_defaults"],
            json!({"priority":2,"status":"ready"})
        );
        let derived = respond(json!({"version":1,"op":"derive","source":source,"now_ms":0,"rows":[
            {"doc":"a.md","props":{"priority":{"kind":"number","value":2},"status":{"kind":"text","value":"ready"},"lane":{"kind":"text","value":"Done"}}}
        ]})).unwrap();
        assert_eq!(
            derived["rows"][0]["values"]["formula.a"],
            json!({"kind":"error","value":"cycle"})
        );
    }
}
