//! Le storie che un nodo della proiezione porta con sé.
//!
//! Un riferimento a una nota, una casella di testo o un'intestazione è un id
//! di parte, e l'id lo dà la lettura: il file nuovo, riletto, numera le parti
//! nell'ordine in cui le scrive. Dopo un salvataggio che sposta, aggiunge o
//! toglie una nota, gli id che la shell tiene nel buffer nominano le parti
//! sbagliate. Per questo un oggetto e una sezione portano le storie che
//! mostrano, con il loro contenuto, come porta i propri dati ogni altro nodo
//! (vedi [`crate::blob`]): al salvataggio le storie tornano con l'id che
//! hanno nel documento, se lì sono identiche, o con un id nuovo.

use std::collections::BTreeMap;
use std::sync::Arc;

use wordcraft_doc::section::HeaderSet;
use wordcraft_doc::{Block, Document, InlineObject, Paragraph, Part, SectionProps};

use crate::fidelity::{each_paragraph, shown};
use crate::RichError;

/// Le storie che `roots` mostrano, per id, e quelle che queste mostrano a
/// loro volta.
pub(crate) fn closure(document: &Document, roots: Vec<u32>) -> BTreeMap<u32, Part> {
    let mut out = BTreeMap::new();
    let mut todo = roots;
    while let Some(id) = todo.pop() {
        if out.contains_key(&id) {
            continue;
        }
        let Some(part) = document.parts.get(&id) else {
            continue;
        };
        for block in &part.blocks {
            each_paragraph(block, &mut |paragraph| todo.extend(shown(paragraph)));
        }
        out.insert(id, part.clone());
    }
    out
}

/// Le storie di un oggetto: le note e le caselle di testo che mostra.
pub(crate) fn of_object(document: &Document, object: &InlineObject) -> BTreeMap<u32, Part> {
    let roots = match object {
        InlineObject::NoteRef { id, .. } => vec![*id],
        object => object.text_boxes(),
    };
    closure(document, roots)
}

/// Le storie di una sezione: le sue intestazioni e i suoi piè di pagina.
pub(crate) fn of_section(document: &Document, section: &SectionProps) -> BTreeMap<u32, Part> {
    closure(document, section_ids(section).collect())
}

fn section_ids(section: &SectionProps) -> impl Iterator<Item = u32> + '_ {
    let sets = |set: &HeaderSet| [set.default, set.first, set.even].into_iter().flatten();
    sets(&section.headers).chain(sets(&section.footers))
}

/// Le storie portate da un nodo, rimesse nel documento: gli stessi id se lì
/// ogni storia è identica e `free` li lascia prendere, altrimenti id nuovi,
/// con i riferimenti fra le storie riscritti. Il risultato dice dove è finito
/// ciascun id portato.
pub(crate) fn restore(
    document: &mut Document,
    parts: BTreeMap<u32, Part>,
    free: &dyn Fn(u32) -> bool,
) -> Result<BTreeMap<u32, u32>, RichError> {
    if parts
        .iter()
        .all(|(id, part)| free(*id) && document.parts.get(id) == Some(part))
    {
        return Ok(parts.keys().map(|id| (*id, *id)).collect());
    }
    let mut moved = BTreeMap::new();
    for (id, part) in &parts {
        let new = document
            .try_add_part(part.kind, Vec::new())
            .map_err(|error| RichError::Codec(error.to_string()))?;
        moved.insert(*id, new);
    }
    for (id, mut part) in parts {
        for block in &mut part.blocks {
            each_paragraph_mut(Arc::make_mut(block), &mut |paragraph| {
                for object in &mut paragraph.objects {
                    remap_object(object, &moved);
                }
                paragraph.touch();
            });
        }
        if let Some(next) = part.body.next.as_mut() {
            if let Some(new) = moved.get(next) {
                *next = *new;
            }
        }
        document.parts.insert(moved[&id], part);
    }
    Ok(moved)
}

/// Gli id delle storie che l'oggetto mostra, secondo `moved`.
pub(crate) fn remap_object(object: &mut InlineObject, moved: &BTreeMap<u32, u32>) {
    if let InlineObject::NoteRef { id, .. } = object {
        if let Some(new) = moved.get(id) {
            *id = *new;
        }
    }
    for slot in object.text_box_slots() {
        if let Some(new) = slot.as_ref().and_then(|id| moved.get(id)) {
            *slot = Some(*new);
        }
    }
}

/// Gli id delle intestazioni e dei piè di pagina della sezione, secondo
/// `moved`.
pub(crate) fn remap_section(section: &mut SectionProps, moved: &BTreeMap<u32, u32>) {
    for set in [&mut section.headers, &mut section.footers] {
        for slot in [&mut set.default, &mut set.first, &mut set.even] {
            if let Some(new) = slot.as_ref().and_then(|id| moved.get(id)) {
                *slot = Some(*new);
            }
        }
    }
}

/// Come [`each_paragraph`], per modificare.
pub(crate) fn each_paragraph_mut(block: &mut Block, f: &mut dyn FnMut(&mut Paragraph)) {
    let mut todo = vec![block];
    while let Some(block) = todo.pop() {
        match block {
            Block::Para(paragraph) => f(paragraph),
            Block::Table(table) => todo.extend(
                table
                    .rows
                    .iter_mut()
                    .flat_map(|row| row.cells.iter_mut())
                    .flat_map(|cell| cell.blocks.iter_mut())
                    .map(Arc::make_mut),
            ),
        }
    }
}
