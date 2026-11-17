//! Immagini, note e altri oggetti: nuovi, tolti, spostati o rifiutati.

use super::*;

#[test]
fn togliere_un_oggetto_lo_toglie_e_un_oggetto_estraneo_è_rifiutato() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    let figure = para_mut(&mut p, 5);
    let image = figure.c.remove(0);
    let after = read(&saved(&file, &p));
    assert!(!paragraph(&after, 5)
        .objects
        .iter()
        .any(|o| matches!(o, InlineObject::Image { .. })));

    // Un'immagine che il documento non ha non si inventa.
    let mut other = sample();
    other.media.clear();
    let other = bytes(&{
        let mut d = other;
        d.body.truncate(5);
        d
    });
    let mut q = projection(&other);
    para_mut(&mut q, 1).c.push(image);
    let result = save(Codec::Docx, &other, &q.to_json().unwrap());
    assert!(matches!(result, Err(RichError::Missing(_))), "{result:?}");
}

/// Un'immagine nuova, come la inserisce la shell.
fn new_image(bytes: &[u8], alt: &str) -> Inline {
    Inline::Atom {
        ins: None,
        del: None,
        k: None,
        kind: AtomKind::Image,
        label: alt.into(),
        w: Some(72.0),
        h: Some(36.0),
        data: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
        note: None,
        end: false,
        toc: None,
        comment: None,
        ink: None,
        svg: None,
        float: None,
    }
}

/// Una nota nuova, come la inserisce la shell.
fn new_note(text: &str, end: bool) -> Inline {
    Inline::Atom {
        ins: None,
        del: None,
        k: None,
        kind: AtomKind::Note,
        label: String::new(),
        w: None,
        h: None,
        data: None,
        note: Some(text.into()),
        end,
        toc: None,
        comment: None,
        ink: None,
        svg: None,
        float: None,
    }
}

#[test]
fn immagini_e_note_nuove_si_scrivono_e_si_riscrivono_uguali() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    // Un PNG diverso da quello che il documento ha già, e lo stesso.
    let other: Vec<u8> = PNG.iter().copied().chain(*b"altro").collect();
    let para = para_mut(&mut p, 1);
    para.c.push(new_image(&other, "Il logo"));
    para.c.push(new_image(PNG, ""));
    para.c.push(new_note("Una nota nuova.", false));
    para.c.push(new_note("In fondo.", true));
    let out = saved(&file, &p);
    let after = read(&out);
    let before = read(&file);
    let objects = &paragraph(&after, 1).objects;
    let InlineObject::Image {
        media, w, h, alt, ..
    } = &objects[0]
    else {
        panic!("{objects:?}")
    };
    assert_eq!((*w, *h, alt.as_str()), (72.0, 36.0, "Il logo"));
    assert_eq!(after.media[media].as_slice(), other.as_slice());
    assert!(
        media.starts_with("fub-") && media.ends_with(".png"),
        "{media}"
    );
    // Gli stessi byte di un'immagine che c'era: la stessa immagine.
    let InlineObject::Image { media: same, .. } = &objects[1] else {
        panic!()
    };
    assert_eq!(after.media.len(), before.media.len() + 1);
    assert_eq!(after.media[same].as_slice(), PNG);
    // Le note: una storia ciascuna, con lo stile e il segno di Word.
    let notes: Vec<(NoteKind, u32)> = objects
        .iter()
        .filter_map(|o| match o {
            InlineObject::NoteRef { kind, id, .. } => Some((*kind, *id)),
            _ => None,
        })
        .collect();
    assert_eq!(notes.len(), 2);
    for ((kind, id), (want, text, style)) in notes.iter().zip([
        (PartKind::Footnote, "Una nota nuova.", "FootnoteText"),
        (PartKind::Endnote, "In fondo.", "EndnoteText"),
    ]) {
        let part = &after.parts[id];
        assert_eq!(part.kind, want, "{kind:?}");
        let story = part.blocks[0].as_para().unwrap();
        assert_eq!(story.props.style.as_deref(), Some(style));
        assert!(story.plain_text().ends_with(&format!(" {text}")));
        assert!(matches!(&story.objects[0], InlineObject::NoteRef { id: own, .. } if own == id));
        assert!(after.styles.get(style).is_some());
    }
    // Il buffer della shell ha ancora gli oggetti nuovi: salvarlo di nuovo sul
    // file appena scritto non cambia niente.
    assert!(matches!(
        save(Codec::Docx, &out, &p.to_json().unwrap()),
        Ok(Saved::Unchanged)
    ));
    // Togliere la nota nuova toglie anche la sua storia.
    para_mut(&mut p, 1).c.pop();
    let again = read(&saved(&out, &p));
    assert!(!again
        .parts
        .values()
        .any(|part| part.kind == PartKind::Endnote));
    assert_eq!(
        again.parts.len(),
        before.parts.len() + 1,
        "la nota di partenza e quella nuova a piè di pagina"
    );
}

#[test]
fn un_oggetto_nuovo_che_non_si_sa_scrivere_è_rifiutato() {
    let file = bytes(&sample());
    let malformed = |inline: Inline| {
        let mut p = projection(&file);
        para_mut(&mut p, 1).c.push(inline);
        let result = save(Codec::Docx, &file, &p.to_json().unwrap());
        assert!(matches!(result, Err(RichError::Malformed(_))), "{result:?}");
    };
    malformed(new_image(b"<svg/>", ""));
    malformed(new_note("due\nrighe", false));
    let Inline::Atom { data, .. } = new_image(PNG, "") else {
        unreachable!()
    };
    malformed(Inline::Atom {
        ins: None,
        del: None,
        k: None,
        kind: AtomKind::Field,
        label: String::new(),
        w: Some(1.0),
        h: Some(1.0),
        data,
        note: None,
        end: false,
        toc: None,
        comment: None,
        ink: None,
        svg: None,
        float: None,
    });
}

/// Il testo della nota che ciascun paragrafo del corpo mostra.
fn notes_shown(bytes: &[u8]) -> Vec<(String, String)> {
    let d = read(bytes);
    d.body
        .iter()
        .filter_map(|b| b.as_para())
        .filter_map(|p| {
            let id = p.objects.iter().find_map(|o| match o {
                InlineObject::NoteRef { id, .. } => Some(*id),
                _ => None,
            })?;
            let note = d.parts[&id].blocks[0].as_para().unwrap().plain_text();
            Some((
                p.plain_text().replace('\u{fffc}', ""),
                note.replace('\u{fffc}', "").trim().to_string(),
            ))
        })
        .collect()
}

#[test]
fn le_note_spostate_restano_loro_anche_al_secondo_salvataggio() {
    // Il file riletto numera le note nell'ordine del testo: dopo il primo
    // salvataggio gli id del buffer della shell nominano le note dell'altro.
    let mut d = Document::new();
    let mut body = Vec::new();
    for t in ["A", "B"] {
        let note = text(&format!("nota {t}"), CharProps::default());
        let id = d.add_part(PartKind::Footnote, vec![para_block(note)]);
        let mut p = text(t, CharProps::default());
        let reference = InlineObject::NoteRef {
            kind: NoteKind::Footnote,
            id,
            custom: String::new(),
        };
        p.insert_object(1, reference, &CharProps::default())
            .unwrap();
        body.push(para_block(p));
    }
    d.body = body;
    let file = bytes(&d);
    let mut p = projection(&file);
    p.blocks.swap(0, 1);
    let one = saved(&file, &p);
    let want = |b: &str| {
        vec![
            (format!("B{b}"), "nota B".to_string()),
            ("A".to_string(), "nota A".to_string()),
        ]
    };
    assert_eq!(notes_shown(&one), want(""));
    let Inline::Text { x, .. } = &mut para_mut(&mut p, 0).c[0] else {
        panic!()
    };
    x.push('!');
    let two = saved(&one, &p);
    assert_eq!(notes_shown(&two), want("!"));
    // Lo stesso buffer, salvato ancora: niente da scrivere.
    assert!(matches!(
        save(Codec::Docx, &two, &p.to_json().unwrap()),
        Ok(Saved::Unchanged)
    ));
}

#[test]
fn l_intestazione_di_una_sezione_resta_sua_dopo_una_nota_tolta() {
    // Le note si leggono prima delle intestazioni: una nota in meno sposta
    // l'id dell'intestazione che la sezione del buffer nomina.
    let mut d = Document::new();
    let note = d.add_part(
        PartKind::Footnote,
        vec![para_block(text("La nota", CharProps::default()))],
    );
    let header = d.add_part(
        PartKind::Header,
        vec![para_block(text("Testata", CharProps::default()))],
    );
    let mut noted = text("Con nota", CharProps::default());
    let reference = InlineObject::NoteRef {
        kind: NoteKind::Footnote,
        id: note,
        custom: String::new(),
    };
    noted
        .insert_object(0, reference, &CharProps::default())
        .unwrap();
    let mut first = text("Prima sezione", CharProps::default());
    let mut section = d.last_section.clone();
    section.headers.default = Some(header);
    first.section = Some(Box::new(section));
    d.body = vec![
        para_block(noted),
        para_block(first),
        para_block(text("Seconda", CharProps::default())),
    ];
    let file = bytes(&d);
    let mut p = projection(&file);
    p.blocks.remove(0);
    let one = saved(&file, &p);
    let Inline::Text { x, .. } = &mut para_mut(&mut p, 1).c[0] else {
        panic!()
    };
    x.push('!');
    let after = read(&saved(&one, &p));
    let section = after.body[0].as_para().unwrap().section.as_deref();
    let id = section
        .and_then(|s| s.headers.default)
        .expect("la sezione e la sua intestazione");
    assert_eq!(after.parts[&id].kind, PartKind::Header);
    assert_eq!(
        after.parts[&id].blocks[0].as_para().unwrap().plain_text(),
        "Testata"
    );
    assert_eq!(after.parts.len(), 1, "{:?}", after.parts.keys());
}

#[test]
fn la_stessa_nota_due_volte_è_rifiutata() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    let figure = para_mut(&mut p, 5);
    let note = figure.c.last().unwrap().clone();
    figure.c.push(note);
    let result = save(Codec::Docx, &file, &p.to_json().unwrap());
    assert!(
        matches!(result, Err(RichError::DuplicateStory(_))),
        "{result:?}"
    );
}
