//! Le intestazioni e i piè di pagina delle sezioni come righe di testo
//! ([`RunningText`]).
//!
//! Di una sezione si mostra la storia delle pagine senza una propria
//! (`default`): quelle della prima pagina e delle pari restano come sono. Una
//! storia che le righe dicono per intero — soltanto paragrafi con lo stesso
//! aspetto, testo e numeri di pagina — si riscrive con quell'aspetto; ogni
//! altra si mostra bloccata, e cambiarla è una proiezione malformata.

use std::sync::Arc;

use wordcraft_doc::para::OBJ;
use wordcraft_doc::{
    Block as WcBlock, CharProps, Document, InlineObject, ParaProps, Paragraph, PartKind,
    SectionProps,
};

use crate::projection::{PageField, Piece, RunningText};
use crate::RichError;

/// Il testo con cui un campo di numero di pagina si riconosce.
fn page_field(instr: &str) -> Option<PageField> {
    let words: Vec<&str> = instr.split_whitespace().collect();
    let plain = match words.as_slice() {
        [word] => Some(*word),
        [word, "\\*", format] if format.eq_ignore_ascii_case("MERGEFORMAT") => Some(*word),
        _ => None,
    }?;
    if plain.eq_ignore_ascii_case("PAGE") {
        Some(PageField::Page)
    } else if plain.eq_ignore_ascii_case("NUMPAGES") {
        Some(PageField::Pages)
    } else {
        None
    }
}

/// Ciò che una storia dice e l'aspetto con cui si riscrive.
struct Read {
    text: RunningText,
    props: ParaProps,
    mark: CharProps,
    look: CharProps,
    /// Il primo campo di ogni specie, da ripetere com'è.
    fields: Vec<(PageField, InlineObject)>,
}

fn read(document: &Document, id: u32) -> Option<Read> {
    let part = document.parts.get(&id)?;
    let mut lines = Vec::new();
    let mut locked = false;
    let mut first: Option<&Paragraph> = None;
    let mut look: Option<&CharProps> = None;
    let mut fields: Vec<(PageField, InlineObject)> = Vec::new();
    for block in &part.blocks {
        let Some(paragraph) = block.as_para() else {
            locked = true;
            continue;
        };
        match first {
            Some(first) => locked |= first.props != paragraph.props || first.mark != paragraph.mark,
            None => first = Some(paragraph),
        }
        locked |= paragraph.section.is_some();
        for run in &paragraph.runs {
            match look {
                Some(look) => locked |= *look != run.props,
                None => look = Some(&run.props),
            }
        }
        let mut pieces = Vec::new();
        let mut text = String::new();
        let mut objects = paragraph.objects.iter();
        for ch in paragraph.text.chars() {
            if ch != OBJ {
                // Un a-capo o un salto non è una riga: le righe sono paragrafi.
                locked |= matches!(ch, '\n' | '\u{000C}' | '\u{000E}');
                text.push(ch);
                continue;
            }
            match objects.next() {
                Some(object @ InlineObject::Field { instr, result, .. }) => match page_field(instr)
                {
                    Some(field) => {
                        if !text.is_empty() {
                            pieces.push(Piece::Text(std::mem::take(&mut text)));
                        }
                        pieces.push(Piece::Field { field });
                        match fields.iter().find(|(kind, _)| *kind == field) {
                            Some((_, seen)) => locked |= seen != object,
                            None => fields.push((field, object.clone())),
                        }
                    }
                    None => {
                        text.push_str(result);
                        locked = true;
                    }
                },
                _ => locked = true,
            }
        }
        if !text.is_empty() {
            pieces.push(Piece::Text(text));
        }
        lines.push(pieces);
    }
    let first = first.cloned().unwrap_or_default();
    Some(Read {
        text: RunningText { lines, locked },
        look: look.cloned().unwrap_or_else(|| first.mark.clone()),
        props: first.props,
        mark: first.mark,
        fields,
    })
}

/// La storia `id` come righe, se c'è.
pub(crate) fn of(document: &Document, id: Option<u32>) -> Option<RunningText> {
    read(document, id?).map(|read| read.text)
}

/// Mette nella sezione l'intestazione e il piè di pagina voluti. Una storia
/// che non cambia resta quella che è; una cambiata è una storia nuova, con
/// l'aspetto di quella di prima (o di Word, se non c'era), e la vecchia resta
/// a chi altro la mostra.
pub(crate) fn apply(
    document: &mut Document,
    section: &mut SectionProps,
    header: Option<&RunningText>,
    footer: Option<&RunningText>,
) -> Result<(), RichError> {
    let id = write(document, section.headers.default, header, PartKind::Header)?;
    section.headers.default = id;
    let id = write(document, section.footers.default, footer, PartKind::Footer)?;
    section.footers.default = id;
    Ok(())
}

fn write(
    document: &mut Document,
    current: Option<u32>,
    wanted: Option<&RunningText>,
    kind: PartKind,
) -> Result<Option<u32>, RichError> {
    let read = current.and_then(|id| read(document, id));
    if read.as_ref().map(|read| &read.text) == wanted {
        return Ok(current);
    }
    let Some(wanted) = wanted else {
        return Ok(None);
    };
    if wanted.locked || read.as_ref().is_some_and(|read| read.text.locked) {
        return Err(RichError::Malformed(
            "a header or footer that is not plain text changed".into(),
        ));
    }
    if wanted.lines.is_empty() {
        return Err(RichError::Malformed(
            "a header or footer without lines".into(),
        ));
    }
    let read = match read {
        Some(read) => read,
        None => {
            let style = if kind == PartKind::Footer {
                "Footer"
            } else {
                "Header"
            };
            Read {
                text: RunningText {
                    lines: Vec::new(),
                    locked: false,
                },
                props: ParaProps {
                    style: crate::unproject::builtin_style(&mut document.styles, style),
                    ..ParaProps::default()
                },
                mark: CharProps::default(),
                look: CharProps::default(),
                fields: Vec::new(),
            }
        }
    };
    let mut blocks = Vec::new();
    for line in &wanted.lines {
        let mut paragraph = Paragraph::new();
        paragraph.props = read.props.clone();
        paragraph.mark = read.mark.clone();
        for piece in line {
            match piece {
                Piece::Text(text) => {
                    if text
                        .chars()
                        .any(|c| matches!(c, OBJ | '\n' | '\r' | '\u{000C}' | '\u{000E}'))
                    {
                        return Err(RichError::Malformed(
                            "a header or footer line that breaks".into(),
                        ));
                    }
                    let at = paragraph.text.len();
                    paragraph
                        .insert_text(at, text, &read.look)
                        .map_err(|error| RichError::Codec(error.to_string()))?;
                }
                Piece::Field { field } => {
                    let object = read
                        .fields
                        .iter()
                        .find(|(kind, _)| kind == field)
                        .map(|(_, object)| object.clone())
                        .unwrap_or_else(|| InlineObject::Field {
                            instr: match field {
                                PageField::Page => "PAGE",
                                PageField::Pages => "NUMPAGES",
                            }
                            .into(),
                            result: "1".into(),
                            locked: false,
                            dirty: false,
                            code: false,
                            form: String::new(),
                        });
                    let at = paragraph.text.len();
                    paragraph
                        .insert_object(at, object, &read.look)
                        .map_err(|error| RichError::Codec(error.to_string()))?;
                }
            }
        }
        blocks.push(Arc::new(WcBlock::Para(paragraph)));
    }
    let id = document
        .try_add_part(kind, blocks)
        .map_err(|error| RichError::Codec(error.to_string()))?;
    Ok(Some(id))
}
