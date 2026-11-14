//! Il lettore delle scalette: una riga è una scheda, e il rientro dice chi è il
//! genitore. Un livello è 2 spazi o un tab; i segni d'elenco (`-`, `*`, `+`,
//! `1.`, `1)`) si tolgono. Un rientro che non cade su un livello (3 spazi), o
//! che salta più di un livello, vale il livello più vicino che c'è, e una nota
//! lo dice. Le regole stanno in `docs/reference/canvas-import.md`.

use super::{lines, quote, End, ImportError, Notes, Sketch, SketchEdge, SketchNode, MAX_IMPORTED};
use crate::layout::arrange::Direction;
use crate::ops::NoteCode;

/// Quante colonne vale un tab: un livello.
const TAB_WIDTH: usize = 2;
/// Quante colonne vale un livello.
const LEVEL_WIDTH: usize = 2;

/// Legge una scaletta. Il nome di ogni scheda è il numero della sua riga.
pub(crate) fn read(text: &str, direction: Direction) -> Result<Sketch, ImportError> {
    let mut sketch = Sketch {
        direction: Some(direction),
        ..Sketch::default()
    };
    let mut notes = Notes::default();
    // Le schede aperte, una per livello: l'ultima è la riga di prima.
    let mut open: Vec<usize> = Vec::new();
    for (number, line) in lines(text) {
        if line.trim().is_empty() {
            continue;
        }
        let (width, rest) = indent(line);
        let item = unmarked(rest).trim();
        if item.is_empty() {
            notes.push(
                NoteCode::LineSkipped,
                format!(
                    "line {number}: `{}` has a list mark and no text",
                    quote(line)
                ),
            );
            continue;
        }
        if sketch.nodes.len() >= MAX_IMPORTED {
            return Err(ImportError::TooMany {
                what: "cards in one import",
                limit: MAX_IMPORTED,
            });
        }
        let wanted = width / LEVEL_WIDTH;
        let level = wanted.min(open.len());
        if width % LEVEL_WIDTH != 0 || level != wanted {
            notes.push(
                NoteCode::IndentRounded,
                format!("line {number}: an indent of {width} columns is read as level {level}"),
            );
        }
        open.truncate(level);
        let index = sketch.nodes.len();
        if let Some(&parent) = open.last() {
            sketch.edges.push(SketchEdge {
                from: End::Node(parent),
                to: End::Node(index),
                label: None,
                from_arrow: false,
                to_arrow: true,
            });
        }
        sketch.nodes.push(SketchNode {
            name: number.to_string(),
            text: item.to_owned(),
            parent: None,
            order: index,
        });
        open.push(index);
    }
    if sketch.nodes.is_empty() {
        return Err(ImportError::Invalid(
            "the outline has no line with text".to_owned(),
        ));
    }
    sketch.notes = notes;
    Ok(sketch)
}

/// Le colonne del rientro (un tab ne vale due) e il resto della riga.
fn indent(line: &str) -> (usize, &str) {
    let mut width = 0;
    for (at, character) in line.char_indices() {
        match character {
            ' ' => width += 1,
            '\t' => width += TAB_WIDTH,
            _ => return (width, &line[at..]),
        }
    }
    (width, "")
}

/// La riga senza il segno d'elenco: `-`, `*` o `+`, o un numero con `.` o `)`,
/// seguiti da uno spazio o dalla fine della riga.
fn unmarked(rest: &str) -> &str {
    let after_mark = |tail: &str| -> Option<usize> {
        if tail.is_empty() {
            Some(0)
        } else if tail.starts_with([' ', '\t']) {
            Some(1)
        } else {
            None
        }
    };
    if let Some(tail) = rest
        .strip_prefix('-')
        .or_else(|| rest.strip_prefix('*'))
        .or_else(|| rest.strip_prefix('+'))
    {
        if let Some(skip) = after_mark(tail) {
            return &tail[skip..];
        }
    }
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 && digits <= 9 {
        let tail = &rest[digits..];
        if let Some(tail) = tail.strip_prefix('.').or_else(|| tail.strip_prefix(')')) {
            if let Some(skip) = after_mark(tail) {
                return &tail[skip..];
            }
        }
    }
    rest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i_segni_d_elenco_si_tolgono() {
        assert_eq!(unmarked("- uno"), "uno");
        assert_eq!(unmarked("* due"), "due");
        assert_eq!(unmarked("+ tre"), "tre");
        assert_eq!(unmarked("12. dodici"), "dodici");
        assert_eq!(unmarked("3) tre"), "tre");
        assert_eq!(unmarked("-meno"), "-meno");
        assert_eq!(unmarked("2024 anno"), "2024 anno");
        assert_eq!(unmarked("-"), "");
    }

    #[test]
    fn un_tab_vale_un_livello() {
        assert_eq!(indent("\t\tx"), (4, "x"));
        assert_eq!(indent("   x"), (3, "x"));
    }
}
