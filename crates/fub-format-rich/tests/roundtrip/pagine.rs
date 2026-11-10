//! Sezioni, pagine, intestazioni, piè di pagina e sommario.

use super::*;

#[test]
fn dove_comincia_una_sezione_si_legge_e_si_scrive() {
    let mut d = sample();
    let mut first = text("Prima sezione", CharProps::default());
    first.section = Some(Box::new(d.last_section.clone()));
    d.body.insert(0, para_block(first));
    d.last_section.start = wordcraft_doc::section::SectionStart::Continuous;
    let file = bytes(&d);
    let p = projection(&file);
    assert_eq!(p.page.unwrap().start, SectionBegin::Continuous);
    assert_eq!(
        para_mut(&mut p.clone(), 0).page.as_deref().unwrap().start,
        SectionBegin::NextPage
    );
    // Nella proiezione si scrive soltanto quando non è a pagina nuova.
    let json = p.to_json().unwrap();
    assert_eq!(json.matches(r#""start":"continuous""#).count(), 1);
    assert!(!json.contains("next_page"));
    assert_eq!(save(Codec::Docx, &file, &json), Ok(Saved::Unchanged));
    let mut changed = p.clone();
    changed.page = Some(Page {
        start: SectionBegin::OddPage,
        ..p.page.unwrap()
    });
    assert_eq!(
        read(&saved(&file, &changed)).last_section.start,
        wordcraft_doc::section::SectionStart::OddPage
    );
}

#[test]
fn la_pagina_di_ogni_sezione_va_e_torna() {
    let mut d = sample();
    let mut first = text("Prima sezione", CharProps::default());
    first.section = Some(Box::new(d.last_section.clone()));
    d.body.insert(0, para_block(first));
    let file = bytes(&d);
    let p = projection(&file);
    // Letter con margini di un pollice, come Word.
    let letter = Page {
        w: 612.0,
        h: 792.0,
        top: 72.0,
        bottom: 72.0,
        left: 72.0,
        right: 72.0,
        cols: 1,
        start: Default::default(),
    };
    assert_eq!(p.page, Some(letter));
    assert_eq!(para_mut(&mut p.clone(), 0).page.as_deref(), Some(&letter));
    assert_eq!(para_mut(&mut p.clone(), 1).page, None);

    // La prima sezione A4 orizzontale su due colonne, l'ultima con i
    // margini stretti.
    let mut changed = p.clone();
    let a4 = Page {
        w: 841.89,
        h: 595.28,
        cols: 2,
        ..letter
    };
    para_mut(&mut changed, 0).page = Some(Box::new(a4));
    changed.page = Some(Page {
        top: 36.0,
        bottom: 36.0,
        left: 36.0,
        right: 36.0,
        ..letter
    });
    let out = saved(&file, &changed);
    let reread = read(&out);
    let section = paragraph(&reread, 0).section.as_deref().unwrap();
    assert!(section.landscape);
    // In ventesimi di punto, come li scrive il `.docx`.
    assert_eq!((section.page_w, section.page_h), (841.9, 595.3));
    assert_eq!(section.columns.count, 2);
    assert_eq!(reread.last_section.margin_left, 36.0);
    assert!(!reread.last_section.landscape);
    let again = projection(&out);
    let a4_twips = Page {
        w: 841.9,
        h: 595.3,
        ..a4
    };
    assert_eq!(
        para_mut(&mut again.clone(), 0).page.as_deref(),
        Some(&a4_twips)
    );
    // Riscritta com'è, non scrive; nemmeno con le misure di prima.
    assert_eq!(
        save(Codec::Docx, &out, &again.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );
    assert_eq!(
        save(Codec::Docx, &out, &changed.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );
}

#[test]
fn una_pagina_senza_spazio_per_il_testo_è_rifiutata() {
    let file = bytes(&sample());
    let p = projection(&file);
    let page = p.page.unwrap();
    for wrong in [
        Page {
            left: 300.0,
            right: 300.0,
            ..page
        },
        Page { w: 5.0, ..page },
        Page {
            top: f32::NAN,
            ..page
        },
        Page { cols: 0, ..page },
        Page { cols: 13, ..page },
    ] {
        let mut bad = p.clone();
        bad.page = Some(wrong);
        assert!(
            matches!(
                save(Codec::Docx, &file, &bad.to_json().unwrap_or_default()),
                Err(RichError::Malformed(_))
            ),
            "{wrong:?}"
        );
    }
    // Una pagina su un paragrafo che non chiude una sezione.
    let mut stray = p.clone();
    para_mut(&mut stray, 0).page = Some(Box::new(page));
    assert!(matches!(
        save(Codec::Docx, &file, &stray.to_json().unwrap()),
        Err(RichError::Malformed(_))
    ));
}

fn page_number(instr: &str) -> InlineObject {
    InlineObject::Field {
        instr: instr.into(),
        result: "1".into(),
        locked: false,
        dirty: false,
        code: false,
        form: String::new(),
    }
}

/// Un'intestazione centrata in corsivo, «Relazione — pagina N di M».
fn header_paragraph() -> Paragraph {
    let italic = CharProps {
        italic: Some(true),
        ..CharProps::default()
    };
    let mut p = Paragraph::with_text("Relazione — pagina ", italic.clone());
    p.props.align = Some(wordcraft_doc::Align::Center);
    let at = p.text.len();
    p.insert_object(at, page_number("PAGE"), &italic).unwrap();
    let at = p.text.len();
    p.insert_text(at, " di ", &italic).unwrap();
    let at = p.text.len();
    p.insert_object(at, page_number(" NUMPAGES \\* MERGEFORMAT "), &italic)
        .unwrap();
    p
}

fn lines(text: &[&[Piece]]) -> RunningText {
    RunningText {
        lines: text.iter().map(|line| line.to_vec()).collect(),
        locked: false,
    }
}

fn words(text: &str) -> Piece {
    Piece::Text(text.into())
}

const PAGE: Piece = Piece::Field {
    field: PageField::Page,
};

#[test]
fn intestazioni_e_piè_di_pagina_vanno_e_tornano() {
    let mut d = sample();
    let header = d.add_part(PartKind::Header, vec![para_block(header_paragraph())]);
    d.last_section.headers.default = Some(header);
    let mut first = text("Prima sezione", CharProps::default());
    first.section = Some(Box::new(d.last_section.clone()));
    d.body.insert(0, para_block(first));
    let file = bytes(&d);
    let p = projection(&file);
    let pages = Piece::Field {
        field: PageField::Pages,
    };
    let shown = lines(&[&[
        words("Relazione — pagina "),
        PAGE,
        words(" di "),
        pages.clone(),
    ]]);
    // Le due sezioni mostrano la stessa intestazione, e nessun piè di pagina.
    assert_eq!(p.header.as_ref(), Some(&shown));
    assert_eq!(para_mut(&mut p.clone(), 0).header.as_deref(), Some(&shown));
    assert_eq!(p.footer, None);
    assert_eq!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );

    // L'ultima sezione cambia il testo e aggiunge un piè di pagina; la prima
    // perde l'intestazione.
    let mut changed = p.clone();
    changed.header = Some(lines(&[
        &[
            words("Verbale, pagina "),
            PAGE,
            words(" di "),
            pages.clone(),
        ],
        &[words("bozza")],
    ]));
    changed.footer = Some(lines(&[&[PAGE]]));
    para_mut(&mut changed, 0).header = None;
    let out = saved(&file, &changed);
    let reread = read(&out);
    assert_eq!(
        paragraph(&reread, 0)
            .section
            .as_ref()
            .unwrap()
            .headers
            .default,
        None
    );
    let id = reread.last_section.headers.default.unwrap();
    let blocks = &reread.parts[&id].blocks;
    assert_eq!(blocks.len(), 2);
    let line = blocks[0].as_para().unwrap();
    // L'aspetto e i campi sono quelli di prima.
    assert_eq!(line.props.align, Some(wordcraft_doc::Align::Center));
    assert!(line.runs.iter().all(|run| run.props.italic == Some(true)));
    assert!(line.objects.iter().any(|object| matches!(
        object,
        InlineObject::Field { instr, .. } if instr.contains("NUMPAGES")
    )));
    // Il piè di pagina nuovo è quello di Word.
    let footer = reread.last_section.footers.default.unwrap();
    let footer = reread.parts[&footer].blocks[0].as_para().unwrap();
    assert_eq!(footer.props.style.as_deref(), Some("Footer"));
    assert!(reread.styles.get("Footer").is_some());
    let again = projection(&out);
    assert_eq!(again.header, changed.header);
    assert_eq!(again.footer, changed.footer);
    assert_eq!(para_mut(&mut again.clone(), 0).header, None);
    assert_eq!(
        save(Codec::Docx, &out, &again.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );
}

#[test]
fn un_intestazione_che_le_righe_non_dicono_resta_com_è() {
    let mut d = sample();
    let mut mixed = header_paragraph();
    let at = mixed.text.len();
    mixed
        .insert_text(
            at,
            " grassetto",
            &CharProps {
                bold: Some(true),
                ..CharProps::default()
            },
        )
        .unwrap();
    let header = d.add_part(PartKind::Header, vec![para_block(mixed)]);
    d.last_section.headers.default = Some(header);
    let file = bytes(&d);
    let p = projection(&file);
    let shown = p.header.clone().unwrap();
    assert!(shown.locked);
    // Si mostra comunque, con il testo che ha.
    assert_eq!(shown.lines[0].last(), Some(&words(" grassetto")));
    // Cambiarla è una proiezione malformata; toglierla no.
    let mut bad = p.clone();
    bad.header = Some(RunningText {
        lines: vec![vec![words("altro")]],
        locked: false,
    });
    assert!(matches!(
        save(Codec::Docx, &file, &bad.to_json().unwrap()),
        Err(RichError::Malformed(_))
    ));
    let mut gone = p.clone();
    gone.header = None;
    assert_eq!(
        read(&saved(&file, &gone)).last_section.headers.default,
        None
    );
    // Una riga che va a capo, o un'intestazione senza righe, nemmeno.
    for wrong in [lines(&[&[words("a\nb")]]), lines(&[])] {
        let mut bad = p.clone();
        bad.footer = Some(wrong);
        assert!(matches!(
            save(Codec::Docx, &file, &bad.to_json().unwrap()),
            Err(RichError::Malformed(_))
        ));
    }
}

#[test]
fn un_sommario_nuovo_si_scrive_da_rifare_in_word() {
    let file = bytes(&sample());
    let p = projection(&file);
    let block = |json: &str| serde_json::from_str::<Block>(json).unwrap();
    let mut changed = p.clone();
    changed.blocks.splice(
        0..0,
        [
            block(
                r#"{"t":"para","role":{"kind":"body"},"s":"TOCHeading","c":[{"t":"text","x":"Sommario"},{"t":"atom","kind":"field","toc":3}]}"#,
            ),
            block(r#"{"t":"para","role":{"kind":"body"},"s":"TOC1","c":[{"t":"text","x":"Il titolo"}]}"#),
            block(r#"{"t":"para","role":{"kind":"body"},"s":"TOC2","c":[{"t":"text","x":"Un paragrafo"}]}"#),
        ],
    );
    let out = saved(&file, &changed);
    let reread = read(&out);
    let head = paragraph(&reread, 0);
    assert_eq!(head.props.style.as_deref(), Some("TOCHeading"));
    assert!(matches!(
        head.objects.last(),
        Some(InlineObject::Field { instr, dirty: true, .. }) if instr == "TOC \\o \"1-3\" \\h \\z \\u"
    ));
    // Le voci hanno gli stili di Word, che il documento ora ha.
    assert_eq!(paragraph(&reread, 1).props.style.as_deref(), Some("TOC1"));
    assert_eq!(paragraph(&reread, 2).props.style.as_deref(), Some("TOC2"));
    assert!(reread.styles.get("TOC3").is_some());
    // Riletto, il sommario è un campo come gli altri, e non si riscrive.
    let again = projection(&out);
    assert_eq!(
        save(Codec::Docx, &out, &again.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );
    // Un sommario senza livelli non c'è.
    let mut bad = p.clone();
    bad.blocks.insert(
        0,
        block(r#"{"t":"para","role":{"kind":"body"},"c":[{"t":"atom","kind":"field","toc":0}]}"#),
    );
    assert!(matches!(
        save(Codec::Docx, &file, &bad.to_json().unwrap()),
        Err(RichError::Malformed(_))
    ));
}
