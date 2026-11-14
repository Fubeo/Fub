//! `canvas.read`: la lavagna come testo (una riga per scheda), come lista di
//! operazioni che la ricrea, o come modello. Non scrive niente.
//!
//! Le tre forme vengono dal nucleo (`describe`, T4). Qui si aggiungono la
//! revisione letta, i conti e il riquadro (le stesse cifre della prima riga
//! dell'outline, in campi), e il limite di serie dell'outline: una lavagna di
//! 100 000 schede non si rovescia in una risposta.

use std::collections::HashSet;

use fub_abi::command::{Args, CommandEffect, CommandOutcome};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::HostApi;
use fub_canvas_core::commit::Core;
use fub_canvas_core::describe::{self, DescribeOptions};
use fub_canvas_core::model::{Canvas, CanvasNode, CanvasNodeType};
use serde_json::json;

use super::*;

/// Quanti caratteri al più dà l'outline, se la chiamata non dice altro.
const OUTLINE_CHARS: usize = 20_000;

/// Il limite più alto di `max_chars`: 2⁵³, l'ultimo intero che un numero JSON
/// porta senza perdere cifre.
const MAX_CHARS_LIMIT: f64 = 9_007_199_254_740_992.0;

/// La forma in cui si legge la lavagna.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Form {
    Outline,
    Code,
    Json,
}

impl Form {
    fn parse(raw: &str) -> Result<Self, PluginError> {
        match raw {
            "outline" => Ok(Self::Outline),
            "code" => Ok(Self::Code),
            "json" => Ok(Self::Json),
            other => Err(PluginError::BadArgs(Text::message(
                E_READ_FORM,
                vec![Arg::text("form", other)],
            ))),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Outline => "outline",
            Self::Code => "code",
            Self::Json => "json",
        }
    }
}

pub(super) fn canvas_read(
    args: Args<'_>,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = canvas_doc(&args, host)?;
    let form = Form::parse(args.text(FORM).unwrap_or("outline"))?;
    let ids = ids(args.text(IDS))?;
    let max_chars = max_chars(&args, form)?;

    let revision = host.document_revision(&doc)?;
    let source = host.read_document(&doc)?;
    let core = Core::open(source).map_err(|error| opening(&doc, &error))?;
    let canvas = core.canvas();
    let counts = Counts::of(canvas, ids.as_deref());
    let options = DescribeOptions {
        ids,
        max_chars: match form {
            Form::Outline => Some(max_chars.unwrap_or(OUTLINE_CHARS)),
            Form::Code | Form::Json => None,
        },
    };

    let mut payload = json!({
        "version": 1,
        "kind": "read",
        "doc": doc.as_str(),
        "revision": revision.0,
        "form": form.name(),
        "counts": { "cards": counts.cards, "edges": counts.edges, "groups": counts.groups },
        "bounds": counts.bounds.map(|b| json!({ "x": b.x, "y": b.y, "width": b.width, "height": b.height })),
    });
    match form {
        Form::Outline => {
            payload["text"] = json!(describe::outline(canvas, &options));
        }
        Form::Code => {
            let ops = describe::code(canvas, &options);
            let text = serde_json::to_string_pretty(&ops).map_err(|_| write_error(&doc))?;
            payload["text"] = json!(text);
        }
        Form::Json => {
            payload["model"] = describe::json(canvas, &options).map_err(|_| write_error(&doc))?;
        }
    }
    Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
        ns: LAVAGNA_NS.into(),
        payload,
    }))
}

/// Gli id dati, come lista JSON di testi. Senza `ids` si legge tutta la lavagna;
/// `[]` non legge nessuna scheda.
fn ids(raw: Option<&str>) -> Result<Option<Vec<String>>, PluginError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    serde_json::from_str::<Vec<String>>(raw)
        .map(Some)
        .map_err(|_| PluginError::BadArgs(Text::key(E_READ_IDS)))
}

/// Il limite dell'outline: un intero da zero in su. Vale solo per l'outline: le
/// altre forme non si tagliano, perché una lista tagliata non si ricompila.
fn max_chars(args: &Args<'_>, form: Form) -> Result<Option<usize>, PluginError> {
    let Some(raw) = args.number(MAX_CHARS) else {
        return Ok(None);
    };
    if form != Form::Outline {
        return Err(PluginError::BadArgs(Text::message(
            E_READ_MAX_CHARS_FORM,
            vec![Arg::text("form", form.name())],
        )));
    }
    if raw.fract() != 0.0 || !(0.0..=MAX_CHARS_LIMIT).contains(&raw) {
        return Err(PluginError::BadArgs(Text::key(E_READ_MAX_CHARS)));
    }
    usize::try_from(raw as u64)
        .map(Some)
        .map_err(|_| PluginError::BadArgs(Text::key(E_READ_MAX_CHARS)))
}

/// La lettura che non si può scrivere come JSON: un difetto del nucleo, non
/// degli argomenti.
fn write_error(doc: &DocId) -> PluginError {
    PluginError::Internal(about(E_READ_WRITE, doc, Vec::new()))
}

/// I conti di una lettura: le schede e gli archi che mostra, e il riquadro che
/// le racchiude. Le stesse regole della riga dei conti di `describe::outline`: con
/// `ids` ci sono le schede che sono davvero nella lavagna, e gli archi che vanno
/// fra due di loro.
#[derive(Debug, PartialEq)]
struct Counts {
    cards: usize,
    edges: usize,
    groups: usize,
    bounds: Option<Bounds>,
}

/// Il riquadro: l'angolo in alto a sinistra e la misura.
#[derive(Debug, PartialEq)]
struct Bounds {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

impl Counts {
    fn of(canvas: &Canvas, ids: Option<&[String]>) -> Self {
        let wanted: Option<HashSet<&str>> = ids.map(|ids| ids.iter().map(String::as_str).collect());
        let nodes: Vec<&CanvasNode> = canvas
            .nodes
            .iter()
            .filter(|node| {
                wanted
                    .as_ref()
                    .is_none_or(|ids| ids.contains(node.id.as_str()))
            })
            .collect();
        let shown: HashSet<&str> = nodes.iter().map(|node| node.id.as_str()).collect();
        let edges = canvas
            .edges
            .iter()
            .filter(|edge| {
                wanted.is_none()
                    || (shown.contains(edge.from_node.as_str())
                        && shown.contains(edge.to_node.as_str()))
            })
            .count();
        let groups = nodes
            .iter()
            .filter(|node| node.node_type == CanvasNodeType::Group)
            .count();
        Self {
            cards: nodes.len(),
            edges,
            groups,
            bounds: bounds(&nodes),
        }
    }
}

/// Il riquadro che racchiude le schede. `None` se non ce ne sono.
fn bounds(nodes: &[&CanvasNode]) -> Option<Bounds> {
    let (first, rest) = nodes.split_first()?;
    let (mut left, mut top) = (first.x, first.y);
    let (mut right, mut bottom) = (
        first.x.saturating_add(first.width),
        first.y.saturating_add(first.height),
    );
    for node in rest {
        left = left.min(node.x);
        top = top.min(node.y);
        right = right.max(node.x.saturating_add(node.width));
        bottom = bottom.max(node.y.saturating_add(node.height));
    }
    Some(Bounds {
        x: left,
        y: top,
        width: right.saturating_sub(left),
        height: bottom.saturating_sub(top),
    })
}
