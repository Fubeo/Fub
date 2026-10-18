//! Aprire, modificare come farebbe la shell e salvare, sempre attraverso i
//! byte di un vero `.docx`.

mod common;

use common::{bytes, sample, styled, text};
use fub_format_rich::projection::{
    Align, Block, Cell, Inline, Layout, Line, Look, Mark, Para, Projection, Role, Row, Table,
};
use fub_format_rich::{open, save, Codec, ReadOnly, RichError, Saved};
use wordcraft_doc::para::NoteKind;
use wordcraft_doc::props::{Highlight, LineSpacing, NumRef, Rgb, TextColor};
use wordcraft_doc::{
    para_block, Block as WcBlock, CharProps, Document, InlineObject, ParaProps, Paragraph, PartKind,
};

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

/// Una tabella `rows × cols` che la shell inserisce: senza proprietà, con il
/// testo della cella in ogni cella.
fn new_table(rows: usize, cols: usize) -> Block {
    Block::Table(Table {
        k: None,
        rows: (0..rows)
            .map(|r| Row {
                k: None,
                cells: (0..cols)
                    .map(|c| Cell {
                        k: None,
                        span: None,
                        blocks: vec![Block::Para(Para {
                            role: Role::Body,
                            align: None,
                            k: None,
                            sect: None,
                            p: Layout::default(),
                            s: None,
                            f: Look::default(),
                            c: vec![Inline::Text {
                                x: format!("{r}.{c}"),
                                k: None,
                                m: Vec::new(),
                                href: None,
                                f: Look::default(),
                            }],
                        })],
                    })
                    .collect(),
            })
            .collect(),
    })
}

#[test]
fn una_tabella_nuova_è_la_griglia_di_word() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    p.blocks.insert(1, new_table(2, 3));
    let out = saved(&file, &p);
    let after = read(&out);
    let WcBlock::Table(table) = &*after.body[1] else {
        panic!("non è una tabella")
    };
    assert_eq!(table.props.style.as_deref(), Some("TableGrid"));
    assert!(after.styles.get("TableGrid").is_some());
    let width = after.last_section.text_width();
    assert_eq!(table.grid.len(), 3);
    assert!((table.grid.iter().sum::<f32>() - width).abs() < 0.5);
    assert_eq!(table.rows.len(), 2);
    for (r, row) in table.rows.iter().enumerate() {
        assert_eq!(row.cells.len(), 3);
        for (c, cell) in row.cells.iter().enumerate() {
            assert_eq!(cell.span(), 1);
            assert_eq!(cell.props.width, Some(table.grid[c]));
            assert_eq!(
                cell.blocks[0].as_para().unwrap().plain_text(),
                format!("{r}.{c}")
            );
        }
    }
    // Riaperta, la tabella ha le sue proprietà e si salva senza cambiare.
    let reopened = projection(&out);
    let Block::Table(table) = &reopened.blocks[1] else {
        panic!()
    };
    assert!(table.k.is_some() && table.rows[0].cells[0].k.is_some());
    assert!(matches!(
        save(Codec::Docx, &out, &reopened.to_json().unwrap()),
        Ok(Saved::Unchanged)
    ));
}

#[test]
fn una_colonna_aggiunta_o_tolta_rifà_la_griglia() {
    let file = bytes(&sample());
    let before = read(&file);
    let WcBlock::Table(was) = &*before.body[4] else {
        panic!()
    };
    let total: f32 = was.grid.iter().sum();
    let mut p = projection(&file);
    let Block::Table(table) = &mut p.blocks[4] else {
        panic!()
    };
    // Una colonna in mezzo, come la aggiunge la shell: copia della vicina.
    for row in &mut table.rows {
        let mut cell = row.cells[0].clone();
        cell.blocks.clear();
        row.cells.insert(1, cell);
    }
    let out = saved(&file, &p);
    let after = read(&out);
    let WcBlock::Table(now) = &*after.body[4] else {
        panic!()
    };
    assert_eq!(now.grid.len(), was.grid.len() + 1);
    assert!((now.grid.iter().sum::<f32>() - total).abs() < 0.5);
    for row in &now.rows {
        for (c, cell) in row.cells.iter().enumerate() {
            assert!((cell.props.width.unwrap() - now.grid[c]).abs() < 0.01);
        }
    }
    // E di nuovo via: la griglia torna a due colonne, larga uguale.
    let mut p = projection(&out);
    let Block::Table(table) = &mut p.blocks[4] else {
        panic!()
    };
    for row in &mut table.rows {
        row.cells.remove(1);
    }
    let WcBlock::Table(back) = &*read(&saved(&out, &p)).body[4] else {
        panic!()
    };
    assert_eq!(back.grid.len(), was.grid.len());
    assert!((back.grid.iter().sum::<f32>() - total).abs() < 0.5);
}

#[test]
fn le_celle_si_uniscono_e_si_dividono_in_larghezza() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    let Block::Table(table) = &mut p.blocks[4] else {
        panic!()
    };
    // Unite: la prima cella copre due colonne, la seconda se ne va.
    table.rows[0].cells[0].span = Some(2);
    table.rows[0].cells.remove(1);
    let out = saved(&file, &p);
    let WcBlock::Table(now) = &*read(&out).body[4] else {
        panic!()
    };
    let merged = &now.rows[0].cells[0];
    assert_eq!((now.rows[0].cells.len(), merged.span()), (1, 2));
    let total: f32 = now.grid.iter().sum();
    assert!((merged.props.width.unwrap() - total).abs() < 0.01);
    let mut p = projection(&out);
    let Block::Table(table) = &mut p.blocks[4] else {
        panic!()
    };
    assert_eq!(table.rows[0].cells[0].span, Some(2));
    // E divise: la cella nuova copia quella unita.
    let mut copy = table.rows[0].cells[0].clone();
    copy.blocks.clear();
    table.rows[0].cells[0].span = None;
    copy.span = None;
    table.rows[0].cells.push(copy);
    let WcBlock::Table(back) = &*read(&saved(&out, &p)).body[4] else {
        panic!()
    };
    assert_eq!(back.rows[0].cells.len(), 2);
    assert!(back.rows[0].cells.iter().all(|c| c.span() == 1));
    assert_eq!(back.grid, now.grid);
    assert!((back.rows[0].cells[1].props.width.unwrap() - now.grid[1]).abs() < 0.01);
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
        f: Look::default(),
    });
    assert_eq!(
        save(Codec::Docx, &file, &projection.to_json().unwrap()),
        Err(RichError::ReadOnly(ReadOnly::Projection))
    );
    projection.readonly = None;
    assert!(save(Codec::Docx, &file, &projection.to_json().unwrap()).is_err());
}
