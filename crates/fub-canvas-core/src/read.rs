//! Lettura di una `.canvas`: dal testo del file al [`Canvas`] validato.
//!
//! Il nucleo salta il BOM da sé (RFC 8259 §8.1): non prende in prestito la
//! regola dal contratto, perché non lo vede. Il BOM si salta e non si toglie:
//! il sorgente resta quello del file (#97).

use crate::model::{Canvas, CanvasError, MAX_SOURCE_BYTES};

/// Il BOM UTF-8, come carattere.
const BOM: char = '\u{feff}';

/// Legge e valida una `.canvas`.
///
/// Un sorgente più grande di [`MAX_SOURCE_BYTES`] è un errore; un sorgente di
/// soli spazi è una lavagna vuota; un BOM iniziale si salta; il resto deve
/// essere un oggetto JSON Canvas che passa [`Canvas::validate`].
pub fn parse(source: &str) -> Result<Canvas, CanvasError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(CanvasError::Limit {
            what: "source bytes",
            limit: MAX_SOURCE_BYTES,
        });
    }
    if source.trim().is_empty() {
        return Ok(Canvas::default());
    }
    let body = source.strip_prefix(BOM).unwrap_or(source);
    let canvas: Canvas = serde_json::from_str(body)?;
    canvas.validate()?;
    Ok(canvas)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_blank_source_is_an_empty_canvas() {
        assert_eq!(parse("").unwrap(), Canvas::default());
        assert_eq!(parse(" \n\t\r\n").unwrap(), Canvas::default());
    }

    #[test]
    fn a_leading_bom_is_skipped() {
        let canvas = parse("\u{feff}{\"nodes\":[]}").unwrap();
        assert!(canvas.nodes.is_empty());
    }

    #[test]
    fn an_oversized_source_is_a_limit_error() {
        let big = " ".repeat(MAX_SOURCE_BYTES + 1);
        assert!(matches!(
            parse(&big),
            Err(CanvasError::Limit {
                what: "source bytes",
                ..
            })
        ));
    }

    #[test]
    fn an_invalid_canvas_does_not_pass() {
        let source =
            r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":0,"height":1,"text":""}]}"#;
        assert!(matches!(parse(source), Err(CanvasError::Invalid(_))));
    }

    #[test]
    fn unknown_fields_are_kept() {
        let canvas = parse(r#"{"nodes":[],"fub:ink":{"v":1}}"#).unwrap();
        assert!(canvas.extra.contains_key("fub:ink"));
    }
}
