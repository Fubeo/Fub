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
/// Un sorgente più grande di [`MAX_SOURCE_BYTES`] è un errore; un sorgente
/// vuoto ([`is_blank`]) è una lavagna vuota; un BOM iniziale si salta; il resto
/// deve essere un oggetto JSON Canvas che passa [`Canvas::validate`]. Le regole
/// di lettura (R1–R5, R7, R8) sono in `docs/reference/canvas-format.md`.
pub fn parse(source: &str) -> Result<Canvas, CanvasError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(CanvasError::Limit {
            what: "source bytes",
            limit: MAX_SOURCE_BYTES,
        });
    }
    if is_blank(source) {
        return Ok(Canvas::default());
    }
    let body = skip_bom(source);
    let canvas: Canvas = serde_json::from_str(body)?;
    canvas.validate()?;
    Ok(canvas)
}

/// Una lavagna vuota (R1): un BOM facoltativo, poi solo spazi JSON (RFC 8259
/// §2: spazio, `\t`, `\n`, `\r`). Non `str::trim`, che conta come spazio
/// anche U+0085 o U+00A0: un sorgente così non è vuoto, e la lettura JSON lo
/// rifiuta. È la regola di `isBlankCanvasSource` del lettore TypeScript.
pub fn is_blank(source: &str) -> bool {
    skip_bom(source)
        .bytes()
        .all(|byte| matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
}

/// Il sorgente senza il BOM iniziale, se c'è. Solo il primo: un BOM dopo è un
/// carattere come gli altri.
fn skip_bom(source: &str) -> &str {
    source.strip_prefix(BOM).unwrap_or(source)
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
