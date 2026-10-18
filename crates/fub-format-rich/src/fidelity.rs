//! Quando un documento riletto è lo stesso documento.
//!
//! Il codec non riscrive il file com'era: rinumera le parti (intestazioni, piè
//! di pagina, note, caselle di testo) nell'ordine in cui le scrive, fonde la
//! copia delle impostazioni originali con quelle che genera, e lascia le
//! immagini che nessuno mostra. Niente di questo perde contenuto, ma rende
//! diverso il modello riletto. Questo modulo toglie esattamente quelle
//! differenze, e ciascuna con la propria prova: tutto il resto deve essere
//! uguale campo per campo.

use std::collections::BTreeMap;
use std::sync::Arc;

use wordcraft_doc::section::HeaderSet;
use wordcraft_doc::{Block, Document, InlineObject, Paragraph};
use wordcraft_docx::{settings_kept_unowned, SETTINGS_ORIG};

/// `reread` è `wanted` dopo una scrittura e una lettura del codec.
pub(crate) fn reads_back(wanted: &Document, reread: &Document) -> bool {
    // Le immagini: il codec scrive soltanto quelle che il testo mostra, e
    // un'immagine tolta dal testo se ne va con il file. Un riferimento rimasto
    // senza la sua immagine resterebbe invece nel testo riletto, e lo farebbe
    // diverso.
    if reread
        .media
        .keys()
        .any(|key| !wanted.media.contains_key(key))
    {
        return false;
    }
    // Le impostazioni che il modello non tiene: ogni figlio di `w:settings`
    // che il codec dice di conservare deve esserci, byte per byte.
    let original = wanted.passthrough.get(SETTINGS_ORIG);
    let written = reread.passthrough.get(SETTINGS_ORIG);
    match (original, written) {
        (None, None) => {}
        (Some(original), Some(written)) if settings_kept_unowned(original, written) => {}
        (Some(original), None) if settings_kept_unowned(original, b"") => {}
        _ => return false,
    }
    let mut kept = wanted.clone();
    kept.media.retain(|key, _| reread.media.contains_key(key));
    kept.passthrough.remove(SETTINGS_ORIG);
    let mut reread = reread.clone();
    reread.passthrough.remove(SETTINGS_ORIG);
    let (mut kept, mut reread) = (canonical(kept), canonical(reread));
    if kept == reread {
        return true;
    }
    // Le misure: il file le tiene in unità intere (twip, EMU) e il modello in
    // punti come `f32`, così una misura riletta può differire nell'ultima cifra.
    // Il resto del documento resta uguale campo per campo; i byte delle
    // immagini e delle parti conservate, che non hanno misure, anche.
    if kept.media != reread.media || kept.passthrough != reread.passthrough {
        return false;
    }
    for document in [&mut kept, &mut reread] {
        document.media.clear();
        document.passthrough.clear();
    }
    match (serde_json::to_value(&kept), serde_json::to_value(&reread)) {
        (Ok(kept), Ok(reread)) => close(&kept, &reread),
        _ => false,
    }
}

/// Mezzo twip in punti: la più piccola differenza che il file sa scrivere è
/// un twip (1/20 di punto), e l'EMU è più fine ancora.
const MEASURE_TOLERANCE: f64 = 0.025;

/// Due valori uguali, salvo i numeri non interi entro [`MEASURE_TOLERANCE`].
fn close(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    use serde_json::Value;
    let mut todo = vec![(a, b)];
    while let Some((a, b)) = todo.pop() {
        match (a, b) {
            (Value::Number(x), Value::Number(y)) => {
                if x == y {
                    continue;
                }
                let exact = x.is_i64() || x.is_u64() || y.is_i64() || y.is_u64();
                match (x.as_f64(), y.as_f64()) {
                    (Some(x), Some(y)) if !exact && (x - y).abs() <= MEASURE_TOLERANCE => {}
                    _ => return false,
                }
            }
            (Value::Array(x), Value::Array(y)) if x.len() == y.len() => {
                todo.extend(x.iter().zip(y))
            }
            (Value::Object(x), Value::Object(y)) if x.len() == y.len() => {
                for (key, value) in x {
                    match y.get(key) {
                        Some(other) => todo.push((value, other)),
                        None => return false,
                    }
                }
            }
            (a, b) if a == b => {}
            _ => return false,
        }
    }
    true
}

/// Il documento con le parti numerate nell'ordine in cui il testo le nomina.
///
/// L'ordine è quello di una lettura: il corpo, con le intestazioni e i piè di
/// pagina di ogni sezione e le note e le caselle che i paragrafi mostrano; poi
/// i commenti; poi, in largo, ciò che quelle parti nominano a loro volta. Le
/// parti che nessuno nomina vengono dopo, nell'ordine dei loro id: se il codec
/// ne perde una, i due documenti restano diversi.
pub(crate) fn canonical(mut document: Document) -> Document {
    let order = reference_order(&document);
    let ids: BTreeMap<u32, u32> = order
        .iter()
        .enumerate()
        .map(|(at, old)| (*old, at as u32 + 1))
        .collect();
    // Un riferimento a una parte che non c'è resta distinto da ogni parte che
    // c'è, e uguale a sé stesso nei due documenti.
    let map = |id: u32| {
        ids.get(&id)
            .copied()
            .unwrap_or_else(|| u32::MAX - id.min(u32::MAX / 2))
    };
    let map_set = |set: &mut HeaderSet| {
        for id in [&mut set.default, &mut set.first, &mut set.even]
            .into_iter()
            .flatten()
        {
            *id = map(*id);
        }
    };

    document.objects_mut(
        &|o| matches!(o, InlineObject::NoteRef { .. }) || !o.text_boxes().is_empty(),
        &mut |o| {
            if let InlineObject::NoteRef { id, .. } = o {
                *id = map(*id);
            }
            for id in o.text_box_slots().into_iter().flatten() {
                *id = map(*id);
            }
        },
    );
    for block in document.body.iter_mut() {
        if let Block::Para(paragraph) = &**block {
            if paragraph.section.is_none() {
                continue;
            }
        } else {
            continue;
        }
        if let Block::Para(paragraph) = Arc::make_mut(block) {
            if let Some(section) = paragraph.section.as_deref_mut() {
                map_set(&mut section.headers);
                map_set(&mut section.footers);
            }
        }
    }
    map_set(&mut document.last_section.headers);
    map_set(&mut document.last_section.footers);
    for comment in document.comments.values_mut() {
        comment.part = map(comment.part);
    }
    document.parts = std::mem::take(&mut document.parts)
        .into_iter()
        .map(|(id, mut part)| {
            if let Some(next) = part.body.next.as_mut() {
                *next = map(*next);
            }
            (map(id), part)
        })
        .collect();
    document
}

/// Gli id delle parti nell'ordine canonico: ciascuno una volta.
fn reference_order(document: &Document) -> Vec<u32> {
    let mut order: Vec<u32> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut push = |id: u32, order: &mut Vec<u32>| {
        if document.parts.contains_key(&id) && seen.insert(id) {
            order.push(id);
        }
    };
    let sets = |set: &HeaderSet| [set.default, set.first, set.even].into_iter().flatten();

    for block in &document.body {
        each_paragraph(block, &mut |paragraph| {
            if let Some(section) = paragraph.section.as_deref() {
                for id in sets(&section.headers).chain(sets(&section.footers)) {
                    push(id, &mut order);
                }
            }
            for id in shown(paragraph) {
                push(id, &mut order);
            }
        });
    }
    for id in sets(&document.last_section.headers).chain(sets(&document.last_section.footers)) {
        push(id, &mut order);
    }
    for comment in document.comments.values() {
        push(comment.part, &mut order);
    }
    // In largo: ogni parte trovata può nominarne altre.
    let mut at = 0;
    while let Some(id) = order.get(at).copied() {
        at += 1;
        let Some(part) = document.parts.get(&id) else {
            continue;
        };
        let mut found = Vec::new();
        for block in &part.blocks {
            each_paragraph(block, &mut |paragraph| found.extend(shown(paragraph)));
        }
        found.extend(part.body.next);
        for id in found {
            push(id, &mut order);
        }
    }
    for id in document.parts.keys() {
        push(*id, &mut order);
    }
    order
}

/// Le parti che un paragrafo mostra: le note e le caselle di testo.
fn shown(paragraph: &Paragraph) -> Vec<u32> {
    paragraph
        .objects
        .iter()
        .flat_map(|object| match object {
            InlineObject::NoteRef { id, .. } => vec![*id],
            object => object.text_boxes(),
        })
        .collect()
}

/// Ogni paragrafo di un blocco, in ordine di documento, per quanto annidate
/// siano le tabelle: una pila al posto della ricorsione.
fn each_paragraph<'a>(block: &'a Block, f: &mut dyn FnMut(&'a Paragraph)) {
    let mut todo = vec![block];
    while let Some(block) = todo.pop() {
        match block {
            Block::Para(paragraph) => f(paragraph),
            Block::Table(table) => {
                let cells = table
                    .rows
                    .iter()
                    .rev()
                    .flat_map(|row| row.cells.iter().rev());
                todo.extend(
                    cells
                        .flat_map(|cell| cell.blocks.iter().rev())
                        .map(|b| &**b),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wordcraft_doc::{CharProps, PartKind};

    fn para(text: &str) -> Vec<Arc<Block>> {
        vec![Arc::new(Block::Para(Paragraph::with_text(
            text,
            CharProps::default(),
        )))]
    }

    #[test]
    fn parts_renumbered_by_the_codec_are_the_same_document() {
        let mut a = Document::from_text("corpo");
        let h = a.add_part(PartKind::Header, para("testa"));
        let f = a.add_part(PartKind::Footer, para("piede"));
        a.last_section.headers.default = Some(h);
        a.last_section.footers.default = Some(f);
        // Lo stesso documento con gli id scambiati.
        let mut b = Document::from_text("corpo");
        let f2 = b.add_part(PartKind::Footer, para("piede"));
        let h2 = b.add_part(PartKind::Header, para("testa"));
        b.last_section.headers.default = Some(h2);
        b.last_section.footers.default = Some(f2);
        assert_ne!(a, b);
        assert_eq!(canonical(a.clone()), canonical(b));
        assert!(reads_back(&a, &a));
    }

    #[test]
    fn a_lost_or_changed_part_is_not() {
        let mut a = Document::from_text("corpo");
        let h = a.add_part(PartKind::Header, para("testa"));
        a.last_section.headers.default = Some(h);
        a.add_part(PartKind::Footnote, para("una nota che nessuno mostra"));
        let mut lost = a.clone();
        lost.parts.retain(|_, p| p.kind != PartKind::Footnote);
        assert!(!reads_back(&a, &lost));
        let mut changed = a.clone();
        changed.parts.get_mut(&h).unwrap().blocks = para("un'altra testa");
        assert!(!reads_back(&a, &changed));
    }

    #[test]
    fn a_measure_reread_in_its_last_digit_is_the_same_but_a_real_change_is_not() {
        use serde_json::json;
        assert!(close(
            &json!({"h": 25.544922, "n": 3}),
            &json!({"h": 25.55, "n": 3})
        ));
        assert!(!close(&json!({"h": 25.5}), &json!({"h": 25.6})));
        // Un intero non è una misura arrotondata: resta esatto.
        assert!(!close(&json!({"n": 3}), &json!({"n": 3.01})));
        assert!(!close(&json!({"s": "a"}), &json!({"s": "b"})));
        assert!(!close(&json!([1.0, 2.0]), &json!([1.0])));
    }

    #[test]
    fn the_settings_snapshot_must_keep_what_the_model_does_not_hold() {
        let orig =
            br#"<w:settings xmlns:w="w"><w:rsids><w:rsidRoot w:val="1"/></w:rsids></w:settings>"#;
        let mut a = Document::from_text("corpo");
        a.passthrough
            .insert(SETTINGS_ORIG.into(), Arc::new(orig.to_vec()));
        let mut merged = a.clone();
        merged.passthrough.insert(
            SETTINGS_ORIG.into(),
            Arc::new(br#"<w:settings xmlns:w="w"><w:zoom w:percent="100"/><w:rsids><w:rsidRoot w:val="1"/></w:rsids></w:settings>"#.to_vec()),
        );
        assert!(reads_back(&a, &merged));
        let mut gone = a.clone();
        gone.passthrough.remove(SETTINGS_ORIG);
        assert!(!reads_back(&a, &gone));
    }
}
