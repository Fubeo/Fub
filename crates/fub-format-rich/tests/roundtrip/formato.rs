//! Formato di carattere, paragrafo, stile e link; paragrafi spezzati, incollati
//! e campi.

use super::*;

#[test]
fn il_grassetto_si_toglie_e_si_mette_come_formattazione_diretta() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    for inline in &mut para_mut(&mut p, 1).c {
        if let Inline::Text { x, m, .. } = inline {
            if x == "forte" {
                m.clear();
            }
            if x == "Una prosa " {
                m.push(Mark::I);
            }
        }
    }
    // Togliere il grassetto a un tratto che lo ha dallo stile lo scrive.
    if let Inline::Text { m, .. } = &mut para_mut(&mut p, 0).c[0] {
        assert!(m.contains(&Mark::B), "lo stile Strong è grassetto");
        m.retain(|mark| *mark != Mark::B);
    }
    let after = read(&saved(&file, &p));
    let prose = paragraph(&after, 1);
    let props = |t: &str| prose.props_at(prose.text.find(t).unwrap() + 1).clone();
    assert_eq!(
        props("forte").bold,
        None,
        "il grassetto diretto si toglie, non si nega"
    );
    assert_eq!(props("Una prosa").italic, Some(true));
    assert_eq!(props("Una prosa").font.as_deref(), Some("Georgia"));
    assert_eq!(paragraph(&after, 0).props_at(1).bold, Some(false));
    assert_eq!(
        paragraph(&after, 0).props_at(1).style.as_deref(),
        Some("Strong")
    );
}

#[test]
fn carattere_dimensione_colori_e_maiuscole_vanno_e_tornano() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    let base = para_mut(&mut p, 1).f.clone();
    assert!(base.size.is_some(), "il paragrafo dice la sua dimensione");
    let look = Look {
        font: Some("Courier New".into()),
        size: Some(18.0),
        color: Some("#c00000".into()),
        hl: Some("#00ff00".into()),
    };
    for inline in &mut para_mut(&mut p, 1).c {
        if let Inline::Text { x, m, f, .. } = inline {
            if x == "forte" {
                m.extend([Mark::H, Mark::Caps]);
                *f = look.clone();
            }
            if x == "Una prosa " {
                assert_eq!(
                    f.font.as_deref(),
                    Some("Georgia"),
                    "il carattere diretto si vede"
                );
                // Senza carattere proprio, il tratto torna a quello del paragrafo.
                f.font = None;
                m.push(Mark::SmallCaps);
            }
        }
    }
    let out = saved(&file, &p);
    let after = read(&out);
    let prose = paragraph(&after, 1);
    let props = |t: &str| prose.props_at(prose.text.find(t).unwrap() + 1).clone();
    let strong = props("forte");
    assert_eq!(strong.font.as_deref(), Some("Courier New"));
    assert_eq!(strong.size, Some(18.0));
    assert_eq!(strong.color, Some(TextColor::Rgb(Rgb(0xc0, 0, 0))));
    assert_eq!(strong.highlight, Some(Highlight::BrightGreen));
    assert_eq!(strong.caps, Some(true));
    let plain = props("Una prosa");
    assert_eq!(
        plain.font, None,
        "il carattere diretto si toglie, non si copia"
    );
    assert_eq!(plain.small_caps, Some(true));

    let reopened = projection(&out);
    let Block::Para(prose) = &reopened.blocks[1] else {
        panic!()
    };
    let seen = |t: &str| {
        prose
            .c
            .iter()
            .find_map(|i| match i {
                Inline::Text { x, m, f, .. } if x == t => Some((m.clone(), f.clone())),
                _ => None,
            })
            .unwrap()
    };
    assert_eq!(seen("forte"), (vec![Mark::B, Mark::H, Mark::Caps], look));
    assert_eq!(seen("Una prosa ").0, vec![Mark::SmallCaps]);
    assert_eq!(seen("Una prosa ").1.font, None);
    assert_eq!(prose.f, base, "la base del paragrafo non cambia");
}

#[test]
fn allineamento_disposizione_e_stile_vanno_e_tornano() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    assert!(
        p.styles.iter().any(|s| s.id == "Title"),
        "la galleria propone gli stili del documento: {:?}",
        p.styles
    );
    assert!(
        p.styles
            .iter()
            .all(|s| s.id != "Normal" && s.id != "Heading1"),
        "non il predefinito né quelli dei ruoli"
    );
    let prose = para_mut(&mut p, 1);
    assert_eq!(
        (prose.p.first, prose.p.after),
        (Some(18.0), Some(14.0)),
        "la formattazione diretta si vede"
    );
    assert_eq!((prose.align, prose.s.as_deref()), (None, None));
    prose.align = Some(Align::Center);
    prose.p.left = Some(36.0);
    prose.p.first = None;
    prose.p.line = Some(Line::Multiple(1.5));
    prose.s = Some("Title".into());
    let out = saved(&file, &p);
    let after = read(&out);
    let props = &paragraph(&after, 1).props;
    assert_eq!(props.style.as_deref(), Some("Title"));
    assert_eq!(props.align, Some(wordcraft_doc::Align::Center));
    assert_eq!(props.indent_left, Some(36.0));
    assert_eq!(
        props.indent_first, None,
        "il rientro torna quello dello stile"
    );
    assert_eq!(props.line_spacing, Some(LineSpacing::Multiple(1.5)));
    assert_eq!(props.space_after, Some(14.0), "ciò che non cambia resta");

    let mut reopened = projection(&out);
    let prose = para_mut(&mut reopened, 1);
    assert_eq!(prose.align, Some(Align::Center));
    assert_eq!(prose.s.as_deref(), Some("Title"));
    assert_eq!(prose.p.left, Some(36.0));
    assert_eq!(prose.p.line, Some(Line::Multiple(1.5)));
    assert_eq!(prose.p.first, None);

    // Tutto come lo stile predefinito: la formattazione diretta se ne va.
    prose.align = None;
    prose.p = Layout::default();
    prose.s = None;
    let after = read(&saved(&out, &reopened));
    let props = &paragraph(&after, 1).props;
    assert_eq!(
        (
            props.style.as_deref(),
            props.align,
            props.indent_left,
            props.line_spacing,
            props.space_after
        ),
        (None, None, None, None, None)
    );
}

#[test]
fn il_ruolo_cambia_stile_ed_elenco() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    para_mut(&mut p, 0).role = Role::Body;
    para_mut(&mut p, 1).role = Role::Heading { level: 3 };
    para_mut(&mut p, 3).role = Role::Body;
    para_mut(&mut p, 5).role = Role::List {
        ordered: false,
        level: 1,
    };
    let after = read(&saved(&file, &p));
    assert_eq!(paragraph(&after, 0).props.style, None);
    assert_eq!(
        paragraph(&after, 1).props.style.as_deref(),
        Some("Heading3")
    );
    assert_eq!(
        paragraph(&after, 1).props.space_after,
        Some(14.0),
        "la formattazione diretta resta"
    );
    assert!(after.styles.get("Heading3").is_some());
    let list = paragraph(&after, 2).props.numbering.unwrap();
    assert!(matches!(
        paragraph(&after, 3).props.numbering,
        None | Some(NumRef { num: 0, .. })
    ));
    // La voce nuova continua l'elenco puntato che c'era.
    assert_eq!(
        paragraph(&after, 5).props.numbering,
        Some(NumRef {
            num: list.num,
            level: 1
        })
    );
}

#[test]
fn cambiando_stile_l_allineamento_che_ne_veniva_segue_il_nuovo() {
    let mut document = sample();
    let quote = text("Una citazione", CharProps::default()).styled("Quote");
    document.body.push(para_block(quote));
    document
        .body
        .push(para_block(text("Del corpo", CharProps::default())));
    if document.styles.get("Quote").is_none() {
        let builtin = wordcraft_doc::StyleSheet::builtin();
        document
            .styles
            .upsert(builtin.get("Quote").unwrap().clone());
    }
    let file = bytes(&document);
    let mut p = projection(&file);
    assert_eq!(p.roles.align.quote, Some(Align::Center));
    assert_eq!(
        (
            p.roles.align.body,
            p.roles.align.h.first().copied().flatten()
        ),
        (None, None)
    );
    let last = p.blocks.len() - 1;
    assert_eq!(para_mut(&mut p, last - 1).align, Some(Align::Center));
    // Come fa la shell: la citazione diventa titolo e va a sinistra come lui;
    // il corpo diventa citazione e si centra come lei.
    let heading = para_mut(&mut p, last - 1);
    heading.role = Role::Heading { level: 1 };
    heading.align = None;
    let cited = para_mut(&mut p, last);
    cited.role = Role::Quote;
    cited.align = Some(Align::Center);
    let out = saved(&file, &p);
    let after = read(&out);
    let n = after.body.len();
    assert_eq!(
        (
            paragraph(&after, n - 2).props.align,
            paragraph(&after, n - 1).props.align
        ),
        (None, None),
        "l'allineamento viene dallo stile, non si scrive diretto"
    );
    let mut reopened = projection(&out);
    assert_eq!(
        (
            para_mut(&mut reopened, last - 1).align,
            para_mut(&mut reopened, last).align
        ),
        (None, Some(Align::Center)),
        "si riapre come si vedeva"
    );
}

#[test]
fn un_link_nuovo_prende_lo_stile_dei_link() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    let para = para_mut(&mut p, 1);
    let Inline::Text { href, .. } = &mut para.c[0] else {
        panic!()
    };
    *href = Some("https://example.org".into());
    let after = read(&saved(&file, &p));
    let props = paragraph(&after, 1).props_at(1).clone();
    assert_eq!(props.link.as_deref(), Some("https://example.org"));
    assert_eq!(props.style.as_deref(), Some("Hyperlink"));
}

#[test]
fn spezzare_un_paragrafo_tiene_le_proprietà_in_entrambi() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    let original = para_mut(&mut p, 1).clone();
    let mut first = original.clone();
    first.c.truncate(2);
    let mut second = original;
    second.c.drain(..2);
    p.blocks
        .splice(1..2, [Block::Para(first), Block::Para(second)]);
    let before = read(&file);
    let after = read(&saved(&file, &p));
    assert_eq!(after.body.len(), before.body.len() + 1);
    assert_eq!(paragraph(&after, 1).plain_text(), "Una prosa forte");
    assert_eq!(paragraph(&after, 2).plain_text(), " con un link.");
    assert_eq!(paragraph(&after, 1).props, paragraph(&after, 2).props);
}

#[test]
fn un_paragrafo_incollato_perde_gli_stili_che_qui_non_ci_sono() {
    let file = bytes(&sample());
    let mut d = sample();
    d.styles.upsert(wordcraft_doc::Style {
        id: "Estraneo".into(),
        name: "Estraneo".into(),
        ..Default::default()
    });
    d.body = vec![para_block(styled("da fuori", "Estraneo"))];
    let foreign = projection(&bytes(&d));
    let mut p = projection(&file);
    p.blocks.push(foreign.blocks[0].clone());
    let after = read(&saved(&file, &p));
    let pasted = after.body.last().unwrap().as_para().unwrap();
    assert_eq!(pasted.plain_text(), "da fuori");
    assert_eq!(pasted.props.style, None);
    assert!(after.styles.get("Estraneo").is_none());
}

#[test]
fn un_campo_spezzato_si_ricompone_come_in_wordcraft() {
    let mut d = sample();
    let mut field = Paragraph::new();
    field
        .insert_object(
            0,
            InlineObject::FieldStart {
                instr: "TOC".into(),
                locked: false,
                dirty: false,
            },
            &CharProps::default(),
        )
        .unwrap();
    let at = field.len();
    field
        .insert_text(at, "indice", &CharProps::default())
        .unwrap();
    let at = field.len();
    field
        .insert_object(at, InlineObject::FieldEnd, &CharProps::default())
        .unwrap();
    d.body.push(para_block(field));
    let file = bytes(&d);
    let mut p = projection(&file);
    let last = p.blocks.len() - 1;
    para_mut(&mut p, last).c.remove(0);
    let after = read(&saved(&file, &p));
    let rebuilt = after.body.last().unwrap().as_para().unwrap();
    assert_eq!(rebuilt.plain_text(), "indice");
    assert!(
        rebuilt.objects.is_empty(),
        "il segno di fine rimasto solo se ne va"
    );
}
