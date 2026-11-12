//! Commenti: si mostrano, restano dopo il salvataggio, si aggiungono, si tolgono
//! e si rifiutano se sono sbagliati.

use super::*;

/// Il documento d'esempio con un commento sul secondo paragrafo e una
/// risposta.
fn commented() -> Document {
    use wordcraft_doc::Comment;
    let mut d = sample();
    for (id, author, said, parent) in [
        (1, "Redazione", "Da rivedere.", None),
        (2, "Ada Rossi", "Fatto, mi pare.", Some(1)),
    ] {
        let part = d.add_part(
            PartKind::Comment,
            vec![para_block(text(said, CharProps::default()))],
        );
        d.comments.insert(
            id,
            Comment {
                author: author.into(),
                date: "2026-10-18T10:00:00Z".into(),
                parent,
                part,
                ..Default::default()
            },
        );
    }
    let WcBlock::Para(para) = std::sync::Arc::make_mut(&mut d.body[1]) else {
        panic!("non è un paragrafo");
    };
    para.insert_object(
        0,
        InlineObject::CommentStart { id: 1 },
        &CharProps::default(),
    )
    .unwrap();
    let end = para.len();
    para.insert_object(
        end,
        InlineObject::CommentEnd { id: 1 },
        &CharProps::default(),
    )
    .unwrap();
    d
}

/// Il commento nuovo, come lo aggiunge la shell.
fn new_comment(
    id: u32,
    text: &str,
    parent: Option<u32>,
) -> fub_format_rich::projection::CommentView {
    fub_format_rich::projection::CommentView {
        id,
        k: None,
        by: "Bea Neri".into(),
        at: "2026-10-18T11:00:00Z".into(),
        parent,
        done: false,
        text: text.into(),
    }
}

/// Un segno nuovo di inizio o di fine di un commento.
fn new_anchor(id: u32, end: bool) -> Inline {
    Inline::Atom {
        ins: None,
        del: None,
        k: None,
        kind: AtomKind::Marker,
        label: String::new(),
        w: None,
        h: None,
        data: None,
        note: None,
        end: false,
        toc: None,
        comment: Some(fub_format_rich::projection::Anchor { id, end }),
        ink: None,
        svg: None,
        float: None,
    }
}

/// Gli intervalli dei commenti nel corpo, come `(id, fine)` in ordine.
fn anchors(document: &Document) -> Vec<(u32, bool)> {
    document
        .body
        .iter()
        .filter_map(|block| block.as_para())
        .flat_map(|para| para.objects.iter())
        .filter_map(|object| match object {
            InlineObject::CommentStart { id } => Some((*id, false)),
            InlineObject::CommentEnd { id } => Some((*id, true)),
            _ => None,
        })
        .collect()
}

/// Il testo di un commento, una riga per paragrafo.
fn said(document: &Document, id: u32) -> String {
    let part = &document.parts[&document.comments[&id].part];
    part.blocks
        .iter()
        .filter_map(|block| block.as_para())
        .map(|para| para.plain_text())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn i_commenti_si_mostrano_e_restano_dopo_un_salvataggio() {
    let file = bytes(&commented());
    let p = projection(&file);
    let shown: Vec<_> = p
        .comments
        .iter()
        .map(|c| (c.id, c.by.as_str(), c.parent, c.done, c.text.as_str()))
        .collect();
    assert_eq!(
        shown,
        [
            (1, "Redazione", None, false, "Da rivedere."),
            (2, "Ada Rossi", Some(1), false, "Fatto, mi pare."),
        ]
    );
    let marks: Vec<_> = match &p.blocks[1] {
        Block::Para(para) => para
            .c
            .iter()
            .filter_map(|inline| match inline {
                Inline::Atom { comment, .. } => *comment,
                Inline::Text { .. } => None,
            })
            .map(|a| (a.id, a.end))
            .collect(),
        Block::Table(_) => unreachable!(),
    };
    assert_eq!(marks, [(1, false), (1, true)]);
    assert_eq!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );

    // Una parola cambiata altrove lascia i commenti come sono.
    let mut edited = p.clone();
    if let Inline::Text { x, .. } = &mut para_mut(&mut edited, 0).c[0] {
        *x = "Un titolo".into();
    }
    let out = saved(&file, &edited);
    let d = read(&out);
    assert_eq!(anchors(&d), [(1, false), (1, true)]);
    assert_eq!(said(&d, 1), "Da rivedere.");
    assert_eq!(said(&d, 2), "Fatto, mi pare.");
    assert_eq!(d.comments[&2].parent, Some(1));
    assert_eq!(projection(&out).comments, p.comments);

    // Risolto si scrive e si rilegge.
    let mut done = p.clone();
    done.comments[0].done = true;
    let d = read(&saved(&file, &done));
    assert!(d.comments[&1].resolved);
    assert!(!d.comments[&2].resolved);
}

#[test]
fn un_commento_nuovo_e_la_sua_risposta_si_scrivono() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    p.comments
        .push(new_comment(5, "Prima riga\nseconda riga", None));
    p.comments.push(new_comment(6, "Una risposta.", Some(5)));
    let para = para_mut(&mut p, 1);
    para.c.insert(1, new_anchor(5, false));
    para.c.push(new_anchor(5, true));
    let out = saved(&file, &p);
    let d = read(&out);
    assert_eq!(anchors(&d), [(5, false), (5, true)]);
    assert_eq!(said(&d, 5), "Prima riga\nseconda riga");
    let comment = &d.comments[&5];
    assert_eq!(
        (comment.author.as_str(), comment.initials.as_str()),
        ("Bea Neri", "BN")
    );
    assert_eq!(comment.date, "2026-10-18T11:00:00Z");
    assert_eq!(d.comments[&6].parent, Some(5));

    // Riaperto, il commento nuovo è come gli altri e non riscrive niente.
    let again = projection(&out);
    assert_eq!(again.comments.len(), 2);
    assert!(again.comments.iter().all(|c| c.k.is_some()));
    assert_eq!(
        save(Codec::Docx, &out, &again.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );
}

#[test]
fn togliere_un_commento_toglie_i_suoi_segni_e_il_suo_testo() {
    let file = bytes(&commented());
    let original = read(&file);
    let p = projection(&file);

    let mut gone = p.clone();
    gone.comments.clear();
    let d = read(&saved(&file, &gone));
    assert!(d.comments.is_empty());
    assert_eq!(anchors(&d), []);
    assert_eq!(
        paragraph(&d, 1).plain_text(),
        paragraph(&original, 1).plain_text()
    );
    assert!(d.parts.values().all(|part| part.kind != PartKind::Comment));

    // Tolta soltanto la risposta, il commento resta.
    let mut reply = p.clone();
    reply.comments.retain(|c| c.id != 2);
    let d = read(&saved(&file, &reply));
    assert_eq!(d.comments.keys().copied().collect::<Vec<_>>(), [1]);
    assert_eq!(anchors(&d), [(1, false), (1, true)]);
}

#[test]
fn un_commento_sbagliato_è_rifiutato() {
    let file = bytes(&commented());
    let p = projection(&file);
    let refused = |p: &Projection| save(Codec::Docx, &file, &p.to_json().unwrap());

    // Una risposta il cui commento non c'è più.
    let mut orphan = p.clone();
    orphan.comments.retain(|c| c.id != 1);
    assert!(matches!(refused(&orphan), Err(RichError::Malformed(_))));

    // Lo stesso id due volte.
    let mut twice = p.clone();
    twice.comments.push(new_comment(1, "Di nuovo.", None));
    assert!(matches!(refused(&twice), Err(RichError::Malformed(_))));

    // Caratteri di controllo nel testo nuovo.
    let mut control = p.clone();
    control.comments.push(new_comment(9, "a\u{7}b", None));
    assert!(matches!(refused(&control), Err(RichError::Malformed(_))));
}
