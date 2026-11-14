//! `canvas.preview`: il disegno di una lavagna, com'è o com'era dopo una lista di
//! operazioni, senza scriverla. Non scrive niente.
//!
//! Il disegno è del nucleo (`fub_canvas_core::preview`, T21): qui si leggono la
//! lavagna e la revisione, si applica la lista con le stesse regole di
//! `canvas.check` (la porta è `after_ops`), e si sceglie la forma dell'immagine:
//! un PNG con `draw`, che ha i caratteri di Fub, altrimenti l'SVG come testo. Il
//! payload porta anche l'elenco delle schede col loro numero, quello dell'immagine
//! e della lettura, e se il testo di una scheda non si vede per intero.

use std::borrow::Cow;

use fub_abi::command::{Args, CommandEffect, CommandOutcome};
use fub_abi::edit::{Fnv1a, Revision};
use fub_abi::error::PluginError;
use fub_abi::model::DocId;
use fub_abi::text::{Arg, Text};
use fub_abi::traits::HostApi;
use fub_canvas_core::check::Problem;
use fub_canvas_core::commit::Core;
use fub_canvas_core::model::Canvas;
use fub_canvas_core::preview::{self, Sketch, SketchOptions};
use serde_json::{json, Value};

use super::*;

pub(super) fn canvas_preview(
    args: Args<'_>,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = canvas_doc(&args, host)?;
    let list = operations(args.text(OPS))?;
    let size = size(&args)?;
    let seed = args.text(SEED).map(seed).transpose()?;

    let revision = host.document_revision(&doc)?;
    if let Some(base) = args.text(BASE) {
        if Revision::new(base) != revision {
            return Err(PluginError::Conflict(about(
                E_PREVIEW_BASE,
                &doc,
                Vec::new(),
            )));
        }
    }
    let source = host.read_document(&doc)?;
    let core = Core::open(source).map_err(|error| opening(&doc, &error))?;
    // Lo stesso seme di `canvas.apply` e di `canvas.check`: gli id nuovi del
    // disegno sono quelli che la scrittura darebbe.
    let seed = seed.unwrap_or_else(|| Fnv1a::hash(revision.0.as_bytes()));
    let drawn: Cow<'_, Canvas> = match list {
        Some(list) => Cow::Owned(
            preview::after_ops(core.canvas(), &list, seed)
                .map_err(|problems| refused(&doc, &problems))?,
        ),
        None => Cow::Borrowed(core.canvas()),
    };

    let sketch = preview::sketch(
        &drawn,
        &SketchOptions {
            size,
            ordinals: true,
        },
    );
    let image = image(&sketch, doc.as_str())?;
    let outline: Vec<Value> = sketch
        .outline
        .iter()
        .map(|card| {
            json!({
                "n": card.number,
                "id": card.id,
                "kind": card.kind,
                "clipped": card.clipped,
            })
        })
        .collect();
    let payload = json!({
        "version": 1,
        "kind": "preview",
        "doc": doc.as_str(),
        "revision": revision.0,
        "image": image,
        "outline": outline,
        "outline_omitted": sketch.outline_omitted,
    });
    Ok(CommandOutcome::done().with_effect(CommandEffect::Custom {
        ns: LAVAGNA_NS.into(),
        payload,
    }))
}

/// La lista di operazioni, se c'è: un JSON che non si legge è un argomento
/// sbagliato. Che la lista sia valida lo dice [`preview::after_ops`].
fn operations(raw: Option<&str>) -> Result<Option<Value>, PluginError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    serde_json::from_str::<Value>(raw)
        .map(Some)
        .map_err(|error| ops_json(error.to_string(), "-".to_owned()))
}

/// Il lato lungo: un intero da zero in su. Un numero più grande di `u32` è più
/// grande di 2048, e il nucleo lo stringe.
fn size(args: &Args<'_>) -> Result<u32, PluginError> {
    let Some(raw) = args.number(SIZE) else {
        return Ok(preview::DEFAULT_SIDE);
    };
    if raw.fract() != 0.0 || raw < 0.0 {
        return Err(PluginError::BadArgs(Text::key(E_PREVIEW_SIZE)));
    }
    if raw >= f64::from(u32::MAX) {
        return Ok(u32::MAX);
    }
    Ok(raw as u32)
}

/// Una lista che non si può disegnare: il primo problema, con la posizione
/// dell'operazione da uno e il suo codice, come in `canvas.check`.
fn refused(doc: &DocId, problems: &[Problem]) -> PluginError {
    let first = problems.first();
    let position = first
        .and_then(|problem| problem.index)
        .map_or_else(|| "-".to_owned(), |index| (index + 1).to_string());
    let code = first
        .and_then(|problem| serde_json::to_value(problem.code).ok())
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_else(|| "invalid".to_owned());
    let reason = first.map_or_else(|| "-".to_owned(), |problem| problem.message.clone());
    PluginError::BadArgs(about(
        E_PREVIEW_OPS,
        doc,
        vec![
            Arg::text("position", position),
            Arg::text("code", code),
            Arg::text("reason", reason),
        ],
    ))
}

/// L'immagine: un PNG in base64 con `draw`, l'SVG come testo senza.
#[cfg(feature = "draw")]
fn image(sketch: &Sketch, title: &str) -> Result<Value, PluginError> {
    use base64::Engine as _;

    let png = crate::draw::svg_png(&sketch.svg, title).map_err(|reason| {
        PluginError::Internal(Text::message(
            E_PREVIEW_PNG,
            vec![Arg::text("reason", reason)],
        ))
    })?;
    Ok(json!({
        "media_type": "image/png",
        "width": sketch.width,
        "height": sketch.height,
        "data": base64::engine::general_purpose::STANDARD.encode(png),
    }))
}

/// Senza `draw` non ci sono caratteri da incorporare: l'SVG è il disegno, e il
/// testo delle schede è nel file come testo.
#[cfg(not(feature = "draw"))]
fn image(sketch: &Sketch, _title: &str) -> Result<Value, PluginError> {
    Ok(json!({
        "media_type": "image/svg+xml",
        "width": sketch.width,
        "height": sketch.height,
        "data": sketch.svg,
    }))
}
