//! Aprire, modificare come farebbe la shell e salvare, sempre attraverso i
//! byte di un vero `.docx`.

use fub_format_rich::projection::{Block, Inline, Mark, Para, Projection, Role};
use fub_format_rich::{open, save, Codec, ReadOnly, RichError, Saved};
use wordcraft_doc::numbering::ListKind;
use wordcraft_doc::para::NoteKind;
use wordcraft_doc::props::NumRef;
use wordcraft_doc::{
    para_block, Block as WcBlock, CharProps, Document, InlineObject, ParaProps, Paragraph, Table,
};

/// Un PNG di un pixel.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn text(t: &str, props: CharProps) -> Paragraph {
    Paragraph::with_text(t, props)
}

fn styled(t: &str, style: &str) -> Paragraph {
    text(t, CharProps::default()).styled(style)
}

/// Un documento con un po' di tutto: titolo, prosa con enfasi e link, un
/// elenco, una tabella, un'immagine e una nota.
fn sample() -> Document {
    let mut d = Document::new();
    let num = d.numbering.add_list(ListKind::Bullet);
    let mut title = styled("Il titolo", "Heading1");
    title.runs[0].props.style = Some("Strong".into());
    let mut body = vec![para_block(title)];

    let mut p = Paragraph::new();
    for (t, c) in [
        (
            "Una prosa ",
            CharProps {
                font: Some("Georgia".into()),
                size: Some(11.5),
                ..Default::default()
            },
        ),
        (
            "forte",
            CharProps {
                bold: Some(true),
                ..Default::default()
            },
        ),
        (" con un ", CharProps::default()),
        (
            "link",
            CharProps {
                link: Some("https://fub.app".into()),
                style: Some("Hyperlink".into()),
                ..Default::default()
            },
        ),
        (".", CharProps::default()),
    ] {
        let at = p.len();
        p.insert_text(at, t, &c).unwrap();
    }
    p.props.space_after = Some(14.0);
    p.props.indent_first = Some(18.0);
    body.push(para_block(p));

    for t in ["prima voce", "seconda voce"] {
        let mut li = text(t, CharProps::default());
        li.props.numbering = Some(NumRef { num, level: 0 });
        body.push(para_block(li));
    }

    let mut table = Table::new(2, 2, 400.0);
    for (r, row) in table.rows.iter_mut().enumerate() {
        for (c, cell) in row.cells.iter_mut().enumerate() {
            cell.blocks = vec![para_block(text(
                &format!("cella {r}{c}"),
                CharProps::default(),
            ))];
        }
    }
    body.push(std::sync::Arc::new(WcBlock::Table(table)));

    let media = d.add_media(PNG.to_vec(), "png");
    let foot = d.add_part(
        wordcraft_doc::PartKind::Footnote,
        vec![para_block(text("La nota.", CharProps::default()))],
    );
    let mut figure = text("Figura e nota", CharProps::default());
    figure
        .insert_object(
            0,
            InlineObject::Image {
                media,
                w: 40.0,
                h: 30.0,
                alt: "Un pixel".into(),
                float: Default::default(),
                crop: [0.0; 4],
                ole: None,
            },
            &CharProps::default(),
        )
        .unwrap();
    let end = figure.len();
    figure
        .insert_object(
            end,
            InlineObject::NoteRef {
                kind: NoteKind::Footnote,
                id: foot,
                custom: String::new(),
            },
            &CharProps::default(),
        )
        .unwrap();
    body.push(para_block(figure));
    d.body = body;
    d
}

fn bytes(document: &Document) -> Vec<u8> {
    wordcraft_docx::write(document).unwrap()
}

fn read(bytes: &[u8]) -> Document {
    let mut d = wordcraft_docx::read(bytes).unwrap();
    d.normalize_runs();
    d
}

fn projection(bytes: &[u8]) -> Projection {
    let opened = open(Codec::Docx, bytes).unwrap();
    assert_eq!(
        opened.readonly, None,
        "il documento d'esempio si deve poter modificare"
    );
    Projection::from_json(&opened.projection).unwrap()
}

fn saved(bytes: &[u8], projection: &Projection) -> Vec<u8> {
    match save(Codec::Docx, bytes, &projection.to_json().unwrap()).unwrap() {
        Saved::Bytes(out) => out,
        Saved::Unchanged => panic!("il salvataggio non ha scritto niente"),
    }
}

fn para_mut(projection: &mut Projection, index: usize) -> &mut Para {
    match &mut projection.blocks[index] {
        Block::Para(para) => para,
        Block::Table(_) => panic!("il blocco {index} è una tabella"),
    }
}

fn paragraph(document: &Document, index: usize) -> &Paragraph {
    document.body[index].as_para().unwrap()
}

#[test]
fn si_apre_con_ruoli_enfasi_e_oggetti() {
    let p = projection(&bytes(&sample()));
    let roles: Vec<Role> = p
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Para(para) => Some(para.role),
            Block::Table(_) => None,
        })
        .collect();
    assert_eq!(
        roles,
        [
            Role::Heading { level: 1 },
            Role::Body,
            Role::List {
                ordered: false,
                level: 0
            },
            Role::List {
                ordered: false,
                level: 0
            },
            Role::Body,
        ]
    );
    let Block::Para(prose) = &p.blocks[1] else {
        panic!()
    };
    let strong = prose.c.iter().find_map(|i| match i {
        Inline::Text { x, m, .. } if x == "forte" => Some(m.clone()),
        _ => None,
    });
    assert_eq!(strong, Some(vec![Mark::B]));
    assert!(prose.c.iter().any(|i| matches!(i, Inline::Text { x, href: Some(h), .. } if x == "link" && h == "https://fub.app")));
    let Block::Para(figure) = &p.blocks[5] else {
        panic!()
    };
    assert!(matches!(&figure.c[0], Inline::Atom { label, .. } if label == "Un pixel"));
    assert!(matches!(figure.c.last(), Some(Inline::Atom { .. })));
}

#[test]
fn una_proiezione_non_toccata_non_scrive() {
    let file = bytes(&sample());
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(
        save(Codec::Docx, &file, &opened.projection),
        Ok(Saved::Unchanged)
    );
}

#[test]
fn cambiare_una_parola_lascia_il_resto_com_era() {
    let file = bytes(&sample());
    let before = read(&file);
    let mut p = projection(&file);
    let para = para_mut(&mut p, 1);
    let Inline::Text { x, .. } = &mut para.c[0] else {
        panic!()
    };
    *x = "Una prosa nuova ".into();

    let after = read(&saved(&file, &p));
    let changed = paragraph(&after, 1);
    assert_eq!(changed.plain_text(), "Una prosa nuova forte con un link.");
    let original = paragraph(&before, 1);
    assert_eq!(
        changed.props, original.props,
        "le proprietà del paragrafo restano"
    );
    assert_eq!(
        changed.runs[0].props, original.runs[0].props,
        "il tratto tiene font e corpo"
    );
    assert_eq!(changed.runs.len(), original.runs.len());
    for i in [0, 2, 3, 4] {
        assert_eq!(after.body[i], before.body[i], "il blocco {i} non cambia");
    }
    assert_eq!(after.styles, before.styles);
    assert_eq!(after.parts, before.parts);
    assert_eq!(after.media, before.media);
}

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
fn le_celle_si_scrivono_e_la_tabella_resta() {
    let file = bytes(&sample());
    let before = read(&file);
    let mut p = projection(&file);
    let Block::Table(table) = &mut p.blocks[4] else {
        panic!()
    };
    let Block::Para(cell) = &mut table.rows[1].cells[0].blocks[0] else {
        panic!()
    };
    let Inline::Text { x, .. } = &mut cell.c[0] else {
        panic!()
    };
    *x = "riscritta".into();
    // Una cella svuotata riceve il paragrafo che Word vuole.
    table.rows[0].cells[1].blocks.clear();
    let after = read(&saved(&file, &p));
    let (WcBlock::Table(was), WcBlock::Table(now)) = (&*before.body[4], &*after.body[4]) else {
        panic!()
    };
    assert_eq!(now.props, was.props);
    assert_eq!(now.grid, was.grid);
    assert_eq!(
        now.rows[1].cells[0].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        "riscritta"
    );
    assert_eq!(now.rows[0].cells[1].blocks.len(), 1);
    assert_eq!(
        now.rows[0].cells[1].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        ""
    );
}

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

#[test]
fn le_revisioni_tracciate_aprono_in_sola_lettura() {
    let mut d = sample();
    d.revisions.push(wordcraft_doc::Revision::new(
        wordcraft_doc::RevisionKind::Insert,
        "Ada",
        "2026-10-18T10:00:00Z",
    ));
    let mut tracked = text(
        "aggiunto",
        CharProps {
            ins: Some(0),
            ..Default::default()
        },
    );
    tracked.props = ParaProps::default();
    d.body.push(para_block(tracked));
    let file = bytes(&d);
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Revisions));
    assert_eq!(
        Projection::from_json(&opened.projection).unwrap().readonly,
        Some(ReadOnly::Revisions)
    );
    assert_eq!(
        save(Codec::Docx, &file, &opened.projection),
        Err(RichError::ReadOnly(ReadOnly::Revisions))
    );
}

#[test]
fn una_proiezione_malformata_è_rifiutata_con_la_sua_specie() {
    let file = bytes(&sample());
    let opened = open(Codec::Docx, &file).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&opened.projection).unwrap();
    value["version"] = 2.into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Version(2))
    );
    value["version"] = 1.into();
    value["inatteso"] = true.into();
    assert!(matches!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Malformed(_))
    ));

    let mut p = projection(&file);
    let Inline::Text { x, .. } = &mut para_mut(&mut p, 1).c[0] else {
        panic!()
    };
    x.push('\u{FFFC}');
    assert!(matches!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Err(RichError::Malformed(_))
    ));
}

#[test]
fn un_file_che_non_è_word_non_si_apre() {
    assert!(matches!(
        open(Codec::Docx, b"non sono uno zip"),
        Err(RichError::Codec(_))
    ));
}

#[test]
fn uno_stile_di_tabella_che_il_file_nomina_senza_averlo_resta_ma_uno_incollato_no() {
    // Word ignora uno stile di tabella che il file non definisce, e molti file
    // ne hanno: è del file, e il salvataggio lo lascia.
    let mut d = sample();
    let WcBlock::Table(table) = std::sync::Arc::make_mut(&mut d.body[4]) else {
        panic!()
    };
    table.props.style = Some("Tabella1".into());
    let file = bytes(&d);
    let mut p = projection(&file);
    let Block::Table(table) = &mut p.blocks[4] else {
        panic!()
    };
    let Block::Para(cell) = &mut table.rows[0].cells[0].blocks[0] else {
        panic!()
    };
    let Inline::Text { x, .. } = &mut cell.c[0] else {
        panic!()
    };
    *x = "riscritta".into();
    let pasted = p.blocks[4].clone();
    let after = read(&saved(&file, &p));
    let WcBlock::Table(now) = &*after.body[4] else {
        panic!()
    };
    assert_eq!(now.props.style.as_deref(), Some("Tabella1"));

    // La stessa tabella incollata in un documento che non la nomina perde lo
    // stile che lì non c'è.
    let other = bytes(&{
        let mut d = sample();
        d.body.truncate(2);
        d
    });
    let mut q = projection(&other);
    q.blocks.push(pasted);
    let after = read(&saved(&other, &q));
    // Il corpo di Word finisce con un paragrafo: la tabella è l'ultima prima.
    let now = after
        .body
        .iter()
        .rev()
        .find_map(|b| match &**b {
            WcBlock::Table(t) => Some(t),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        now.rows[0].cells[0].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        "riscritta"
    );
    assert_eq!(now.props.style, None);
}

#[test]
fn ciò_che_il_codec_riscrive_senza_perdere_non_chiude_il_documento() {
    // Il codec rinumera le parti nell'ordine in cui le scrive, arrotonda le
    // misure al twip e fonde le impostazioni che il modello non tiene con
    // quelle che genera: niente di questo è una perdita.
    let mut d = sample();
    let footer = d.add_part(
        wordcraft_doc::PartKind::Footer,
        vec![para_block(text("piede", CharProps::default()))],
    );
    let header = d.add_part(
        wordcraft_doc::PartKind::Header,
        vec![para_block(text("testa", CharProps::default()))],
    );
    d.last_section.headers.default = Some(header);
    d.last_section.footers.default = Some(footer);
    let WcBlock::Table(table) = std::sync::Arc::make_mut(&mut d.body[4]) else {
        panic!()
    };
    table.rows[0].props.height = Some(25.544922);
    let settings = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:zoom w:percent="120"/><w:proofState w:spelling="clean"/><w:defaultTabStop w:val="708"/><w:rsids><w:rsidRoot w:val="00A1B2C3"/></w:rsids></w:settings>"#;
    d.passthrough.insert(
        wordcraft_docx::SETTINGS_ORIG.into(),
        std::sync::Arc::new(settings.as_bytes().to_vec()),
    );
    let file = bytes(&d);
    assert_ne!(read(&file), {
        let mut n = d.clone();
        n.normalize_runs();
        n
    });
    let mut p = projection(&file);
    let Inline::Text { x, .. } = &mut para_mut(&mut p, 1).c[0] else {
        panic!()
    };
    *x = "Una prosa nuova ".into();
    let after = read(&saved(&file, &p));
    let kept = &after.passthrough[wordcraft_docx::SETTINGS_ORIG];
    let kept = std::str::from_utf8(kept).unwrap();
    assert!(
        kept.contains(r#"<w:rsidRoot w:val="00A1B2C3"/>"#) && kept.contains("<w:proofState"),
        "{kept}"
    );
    assert_eq!(
        after.parts[&after.last_section.headers.default.unwrap()].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        "testa"
    );
    assert_eq!(
        after.parts[&after.last_section.footers.default.unwrap()].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        "piede"
    );
}

#[test]
fn una_nota_mostrata_due_volte_apre_in_sola_lettura() {
    // Due rimandi alla stessa nota e uno a un'altra: la superficie non sa
    // mostrare due volte la stessa nota, e il codec di WordCraft non rilegge la
    // seconda. Il documento si legge, non si scrive.
    let mut d = sample();
    let first = d.add_part(
        wordcraft_doc::PartKind::Footnote,
        vec![para_block(text("prima", CharProps::default()))],
    );
    let second = d.add_part(
        wordcraft_doc::PartKind::Footnote,
        vec![para_block(text("seconda", CharProps::default()))],
    );
    let mut p = text("rimandi", CharProps::default());
    for id in [first, first, second] {
        let at = p.len();
        p.insert_object(
            at,
            InlineObject::NoteRef {
                kind: NoteKind::Footnote,
                id,
                custom: String::new(),
            },
            &CharProps::default(),
        )
        .unwrap();
    }
    d.body.push(para_block(p));
    let file = bytes(&d);
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Projection));
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    assert_eq!(projection.readonly, Some(ReadOnly::Projection));
    // Una modifica si rifiuta con il motivo misurato all'apertura; e chi
    // togliesse quel campo trova comunque la rilettura a dire di no.
    para_mut(&mut projection, 0).c.push(Inline::Text {
        x: " cambiato".into(),
        k: None,
        m: Vec::new(),
        href: None,
    });
    assert_eq!(
        save(Codec::Docx, &file, &projection.to_json().unwrap()),
        Err(RichError::ReadOnly(ReadOnly::Projection))
    );
    projection.readonly = None;
    assert!(save(Codec::Docx, &file, &projection.to_json().unwrap()).is_err());
}
