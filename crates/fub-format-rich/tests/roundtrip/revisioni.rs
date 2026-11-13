//! Revisioni tracciate: inserimenti, eliminazioni, revisioni accettate, sola
//! lettura e registrazione delle modifiche.

use super::*;

/// Un documento con revisioni tracciate: `pieces` sono i tratti del primo
/// paragrafo, con l'autore dell'inserimento e dell'eliminazione; il segno del
/// primo paragrafo è inserito da `mark`, e un secondo paragrafo lo segue.
fn tracked(pieces: &[(&str, Option<&str>, Option<&str>)], mark: Option<&str>) -> Document {
    use wordcraft_doc::{Revision, RevisionKind};
    let mut d = Document::new();
    let index = |d: &mut Document, kind: RevisionKind, by: Option<&str>| {
        let by = by?;
        let wanted = Revision::new(kind, by, "2026-10-18T10:00:00Z");
        Some(match d.revisions.iter().position(|r| *r == wanted) {
            Some(at) => at as u32,
            None => {
                d.revisions.push(wanted);
                d.revisions.len() as u32 - 1
            }
        })
    };
    let mut first = Paragraph::new();
    first.mark.ins = index(&mut d, RevisionKind::Insert, mark);
    for (piece, ins, del) in pieces {
        let props = CharProps {
            ins: index(&mut d, RevisionKind::Insert, *ins),
            del: index(&mut d, RevisionKind::Delete, *del),
            ..Default::default()
        };
        let at = first.len();
        first.insert_text(at, piece, &props).unwrap();
    }
    d.body = vec![
        para_block(first),
        para_block(text("dopo", CharProps::default())),
    ];
    d
}

/// Il testo del primo paragrafo, con chi l'ha inserito e chi l'ha eliminato.
fn tracked_text(document: &Document) -> Vec<(String, Option<String>, Option<String>)> {
    let paragraph = paragraph(document, 0);
    let author = |index: Option<u32>| index.map(|i| document.revisions[i as usize].author.clone());
    paragraph
        .run_ranges()
        .map(|(range, props)| {
            (
                paragraph.text[range].to_string(),
                author(props.ins),
                author(props.del),
            )
        })
        .collect()
}

#[test]
fn inserimenti_ed_eliminazioni_si_mostrano_e_si_scrivono() {
    let file = bytes(&tracked(
        &[
            ("fisso ", None, None),
            ("aggiunto", Some("Ada"), None),
            (" ", None, None),
            ("tolto", None, Some("Bea")),
        ],
        Some("Ada"),
    ));
    let p = projection(&file);
    let first = match &p.blocks[0] {
        Block::Para(para) => para,
        Block::Table(_) => unreachable!(),
    };
    assert_eq!(first.ins.as_deref(), rev("Ada").as_ref());
    let shown: Vec<_> = first
        .c
        .iter()
        .map(|inline| match inline {
            Inline::Text { x, ins, del, .. } => (x.as_str(), ins.clone(), del.clone()),
            Inline::Atom { .. } => unreachable!(),
        })
        .collect();
    assert_eq!(
        shown,
        [
            ("fisso ", None, None),
            ("aggiunto", rev("Ada"), None),
            (" ", None, None),
            ("tolto", None, rev("Bea")),
        ]
    );
    // La proiezione com'è non cambia niente.
    assert_eq!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );

    // Accettare l'inserimento e rifiutare l'eliminazione tolgono le
    // revisioni e lasciano il testo.
    let mut kept = p.clone();
    let para = para_mut(&mut kept, 0);
    para.ins = None;
    for inline in &mut para.c {
        if let Inline::Text { ins, del, .. } = inline {
            *ins = None;
            *del = None;
        }
    }
    let out = saved(&file, &kept);
    let d = read(&out);
    assert_eq!(
        tracked_text(&d),
        [("fisso aggiunto tolto".to_string(), None, None)]
    );
    assert_eq!(paragraph(&d, 0).mark.ins, None);
    assert!(projection(&out).blocks.iter().all(|b| match b {
        Block::Para(para) => para.ins.is_none(),
        Block::Table(_) => true,
    }));

    // Rifiutare l'inserimento e accettare l'eliminazione tolgono il testo.
    let mut gone = p.clone();
    para_mut(&mut gone, 0).c.retain(|inline| {
        matches!(
            inline,
            Inline::Text {
                ins: None,
                del: None,
                ..
            }
        )
    });
    let d = read(&saved(&file, &gone));
    assert_eq!(tracked_text(&d), [("fisso  ".to_string(), None, None)]);
    // Il segno inserito resta, con il suo autore.
    assert_eq!(
        paragraph(&d, 0)
            .mark
            .ins
            .map(|i| d.revisions[i as usize].author.clone()),
        Some("Ada".into())
    );
}

#[test]
fn una_revisione_accettata_non_confonde_l_ordine_delle_altre() {
    // Ada compare prima di Bea, e dopo di nuovo: accettato il primo tratto di
    // Ada, il file riletto numera Bea per prima.
    let file = bytes(&tracked(
        &[
            ("uno", Some("Ada"), None),
            (" due", Some("Bea"), None),
            (" tre", Some("Ada"), None),
        ],
        None,
    ));
    let mut p = projection(&file);
    if let Inline::Text { ins, .. } = &mut para_mut(&mut p, 0).c[0] {
        *ins = None;
    }
    let out = saved(&file, &p);
    assert_eq!(
        tracked_text(&read(&out)),
        [
            ("uno".to_string(), None, None),
            (" due".to_string(), Some("Bea".into()), None),
            (" tre".to_string(), Some("Ada".into()), None),
        ]
    );
    // Lo stesso buffer, salvato sul file nuovo, non cambia niente.
    assert_eq!(
        save(Codec::Docx, &out, &p.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );
    // Un tratto di Bea che torna di Ada ritrova la revisione di Ada.
    if let Inline::Text { ins, .. } = &mut para_mut(&mut p, 0).c[1] {
        *ins = rev("Ada");
    }
    assert_eq!(
        tracked_text(&read(&saved(&out, &p))),
        [
            ("uno".to_string(), None, None),
            (" due tre".to_string(), Some("Ada".into()), None),
        ]
    );
}

#[test]
fn le_modifiche_di_formato_tracciate_aprono_in_sola_lettura() {
    use wordcraft_doc::props::PropChange;
    use wordcraft_doc::{Revision, RevisionKind};
    let mut d = sample();
    d.revisions.push(Revision::new(
        RevisionKind::Format,
        "Ada",
        "2026-10-18T10:00:00Z",
    ));
    let mut changed = text(
        "in grassetto",
        CharProps {
            bold: Some(true),
            fmt_change: PropChange::boxed(0, CharProps::default()),
            ..Default::default()
        },
    );
    changed.props = ParaProps::default();
    d.body.push(para_block(changed));
    let last = d.body.len() - 1;
    let file = bytes(&d);
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Revisions));
    let projection = Projection::from_json(&opened.projection).unwrap();
    assert_eq!(projection.readonly, Some(ReadOnly::Revisions));
    // «Che cosa manca?» dice il paragrafo con la revisione di formato.
    assert_eq!(
        projection.missing,
        [Missing {
            what: MissingWhat::Format,
            block: Some(last),
        }]
    );
    assert_eq!(
        save(Codec::Docx, &file, &opened.projection),
        Err(RichError::ReadOnly(ReadOnly::Revisions))
    );
}

#[test]
fn le_revisioni_in_una_nota_aprono_in_sola_lettura() {
    use wordcraft_doc::{Revision, RevisionKind};
    let mut d = sample();
    d.revisions.push(Revision::new(
        RevisionKind::Insert,
        "Ada",
        "2026-10-18T10:00:00Z",
    ));
    let note = d
        .parts
        .iter()
        .find(|(_, part)| part.kind == PartKind::Footnote)
        .map(|(id, _)| *id)
        .expect("l'esempio ha una nota");
    let part = d.parts.get_mut(&note).unwrap();
    part.blocks.push(para_block(text(
        "aggiunta",
        CharProps {
            ins: Some(0),
            ..Default::default()
        },
    )));
    let opened = open(Codec::Docx, &bytes(&d)).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Revisions));
    // La revisione sta in una nota: l'elenco dice le note, senza un blocco.
    assert_eq!(
        Projection::from_json(&opened.projection).unwrap().missing,
        [Missing {
            what: MissingWhat::Note,
            block: None,
        }]
    );
}

#[test]
fn un_documento_che_registra_le_modifiche_si_scrive_con_le_sue_revisioni() {
    let mut d = sample();
    d.settings.track_changes = true;
    let file = bytes(&d);
    let p = projection(&file);
    assert!(p.track);
    assert_eq!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );

    // Una parola scritta registrando: un inserimento di chi scrive.
    let mut typed = p.clone();
    let para = para_mut(&mut typed, 1);
    para.c.push(Inline::Text {
        x: " aggiunta".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
        ins: rev("Bea"),
        del: None,
    });
    let out = saved(&file, &typed);
    let d = read(&out);
    assert!(d.settings.track_changes);
    let last = paragraph(&d, 1).runs.last().unwrap();
    assert_eq!(
        last.props
            .ins
            .map(|i| d.revisions[i as usize].author.clone()),
        Some("Bea".into())
    );
    assert!(projection(&out).track);

    // Smettere di registrare si scrive nelle impostazioni.
    let mut stopped = p.clone();
    stopped.track = false;
    assert!(!read(&saved(&file, &stopped)).settings.track_changes);
    // E cominciare anche.
    let plain = bytes(&sample());
    let mut started = projection(&plain);
    assert!(!started.track);
    started.track = true;
    assert!(read(&saved(&plain, &started)).settings.track_changes);
}
