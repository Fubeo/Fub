//! `canvas.guide`: la guida per scrivere una lavagna con le operazioni. Il testo
//! sta in `guida.md`, e le operazioni (i nomi, i campi, lo schema, gli esempi)
//! vengono da `spec` (T6): così non si scrivono due volte. Non legge nessun
//! documento.

use fub_abi::command::{Args, CommandEffect, CommandOutcome};
use fub_abi::error::PluginError;
use fub_abi::text::{Arg, Text};
use fub_canvas_core::spec::{self, FieldKind, FieldSpec, OpSpec, ProblemCode};
use serde_json::{json, Value};

use super::*;

/// La guida, com'è scritta in `guida.md`: al più 150 righe.
const GUIDE: &str = include_str!("guida.md");

pub(super) fn canvas_guide(args: Args<'_>) -> Result<CommandOutcome, PluginError> {
    // Un topic vuoto è come non averlo.
    let topic = args
        .text(TOPIC)
        .map(str::trim)
        .filter(|topic| !topic.is_empty());
    let ops: Vec<&OpSpec> = spec::OPS
        .iter()
        .filter(|op| topic.is_none_or(|topic| op.name == topic))
        .collect();
    if let Some(topic) = topic {
        if ops.is_empty() {
            return Err(unknown_topic(topic));
        }
    }
    let examples: Vec<Value> = ops
        .iter()
        .flat_map(|op| op.examples.iter())
        .filter_map(|text| serde_json::from_str(text).ok())
        .collect();
    let payload = json!({
        "version": 1,
        "kind": "guide",
        "text": GUIDE,
        "ops": ops.iter().map(|op| operation(op)).collect::<Vec<Value>>(),
        "schema": schema(topic),
        "examples": examples,
    });
    Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
        ns: LAVAGNA_NS.into(),
        payload,
    }))
}

/// Lo schema della lista: tutte le operazioni, o solo il ramo di `topic`.
fn schema(topic: Option<&str>) -> Value {
    let mut schema = spec::json_schema();
    if let (Some(topic), Some(branches)) = (
        topic,
        schema
            .pointer_mut("/items/oneOf")
            .and_then(Value::as_array_mut),
    ) {
        branches.retain(|branch| branch.pointer("/properties/op/const") == Some(&json!(topic)));
    }
    schema
}

/// Un'operazione come la legge chi scrive: il nome, la frase, i campi.
fn operation(op: &OpSpec) -> Value {
    json!({
        "name": op.name,
        "summary": op.summary_it,
        "fields": op.fields.iter().map(field).collect::<Vec<Value>>(),
    })
}

fn field(field: &FieldSpec) -> Value {
    let mut value = json!({
        "name": field.name,
        "kind": kind_name(field.kind),
        "required": field.required,
        "doc": field.doc_it,
    });
    if let Some(default) = field
        .default
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
    {
        value["default"] = default;
    }
    if let FieldKind::Enum(values) = field.kind {
        value["values"] = json!(values);
    }
    value
}

/// Il nome del tipo di un campo, come lo legge chi scrive la lista.
fn kind_name(kind: FieldKind) -> &'static str {
    match kind {
        FieldKind::Id => "id",
        FieldKind::Ids => "ids",
        FieldKind::Number => "number",
        FieldKind::Text => "text",
        FieldKind::Bool => "bool",
        FieldKind::Enum(_) => "enum",
        FieldKind::Node => "node",
        FieldKind::Edge => "edge",
        FieldKind::Object | FieldKind::Patch => "object",
        FieldKind::Points => "points",
        FieldKind::Color => "color",
        FieldKind::Sides => "sides",
        FieldKind::Pair => "pair",
        FieldKind::Layer => "layer",
        FieldKind::Strokes => "strokes",
        FieldKind::Any => "any",
    }
}

/// Un nome che non è un'operazione. Il nome più vicino lo dà la forma delle
/// operazioni (`spec::validate`, con la stessa distanza di sempre); senza vicini
/// si danno tutti i nomi.
fn unknown_topic(topic: &str) -> PluginError {
    let near = spec::validate(&json!([{ "op": topic }]))
        .into_iter()
        .find(|problem| problem.code == ProblemCode::UnknownOp)
        .and_then(|problem| problem.suggestion)
        .unwrap_or_else(|| {
            spec::OPS
                .iter()
                .map(|op| op.name)
                .collect::<Vec<_>>()
                .join(", ")
        });
    PluginError::BadArgs(Text::message(
        E_GUIDE_TOPIC,
        vec![Arg::text("topic", topic), Arg::text("near", near)],
    ))
}
