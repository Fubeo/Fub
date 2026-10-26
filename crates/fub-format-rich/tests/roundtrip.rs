//! Aprire, modificare come farebbe la shell e salvare, sempre attraverso i
//! byte di un vero `.docx`.

mod common;

use base64::Engine;
use common::{bytes, sample, styled, text, PNG};
use fub_format_rich::projection::{
    Align, AtomKind, Block, Cell, Inline, Layout, Line, Look, Mark, Missing, MissingWhat, Page,
    PageField, Para, Piece, Projection, Role, Row, RunningText, SectionBegin, Table, OPAQUE_SCHEMA,
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

/// Un `.docx` scritto a mano, con il solo documento principale.
fn package(body: &str) -> Vec<u8> {
    use std::io::Write;
    const W: &str = r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships""#;
    let types = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
    let rels = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}<w:sectPr/></w:body></w:document>"#
    );
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in [
        ("[Content_Types].xml", types.as_bytes()),
        ("_rels/.rels", rels.as_bytes()),
        ("word/document.xml", document.as_bytes()),
    ] {
        zip.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

/// La parte principale di un `.docx`, come testo.
fn main_part(bytes: &[u8]) -> String {
    use std::io::Read;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    let mut out = String::new();
    zip.by_name("word/document.xml")
        .unwrap()
        .read_to_string(&mut out)
        .unwrap();
    out
}

/// La disposizione asiatica di un tratto non passa dalla proiezione: resta
/// con le proprietà opache del tratto che l'utente ha cambiato. Un testo che
/// arriva senza quelle proprietà la perderebbe, e il salvataggio si rifiuta
/// invece di perderla.
#[test]
fn ciò_che_la_proiezione_non_porta_non_si_perde_nel_paragrafo_cambiato() {
    let file = package(
        r#"<w:p><w:r><w:rPr><w:eastAsianLayout w:id="1" w:combine="1"/></w:rPr><w:t>Primo paragrafo</w:t></w:r></w:p>"#,
    );
    let mut p = projection(&file);
    let Some(Inline::Text { x, .. }) = para_mut(&mut p, 0).c.first_mut() else {
        panic!("il paragrafo comincia col testo")
    };
    x.push_str(" modificato");
    let out = saved(&file, &p);
    let xml = main_part(&out);
    assert!(xml.contains("Primo paragrafo modificato"), "{xml}");
    assert!(xml.contains(r#"w:combine="1""#), "{xml}");

    let Some(Inline::Text { k, .. }) = para_mut(&mut p, 0).c.first_mut() else {
        panic!("il paragrafo comincia col testo")
    };
    *k = None;
    assert_eq!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Err(RichError::Fidelity)
    );
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
        locked: false,
        k: None,
        rows: (0..rows)
            .map(|r| Row {
                k: None,
                cells: (0..cols)
                    .map(|c| Cell {
                        k: None,
                        span: None,
                        blocks: vec![Block::Para(Para {
                            ins: None,
                            del: None,
                            role: Role::Body,
                            locked: false,
                            align: None,
                            k: None,
                            sect: None,
                            page: None,
                            header: None,
                            footer: None,
                            p: Layout::default(),
                            s: None,
                            f: Box::default(),
                            c: vec![Inline::Text {
                                ins: None,
                                del: None,
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

fn rev(by: &str) -> Option<fub_format_rich::projection::Rev> {
    Some(fub_format_rich::projection::Rev {
        by: by.into(),
        at: "2026-10-18T10:00:00Z".into(),
        mv: None,
    })
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
fn un_documento_che_si_scrive_non_dice_che_cosa_manca() {
    let opened = open(Codec::Docx, &bytes(&sample())).unwrap();
    assert_eq!(opened.readonly, None);
    assert!(Projection::from_json(&opened.projection)
        .unwrap()
        .missing
        .is_empty());
}

#[test]
fn una_proiezione_malformata_è_rifiutata_con_la_sua_specie() {
    let file = bytes(&sample());
    let opened = open(Codec::Docx, &file).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&opened.projection).unwrap();
    value["version"] = 4.into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Version(4))
    );
    // Un Fub più nuovo aggiunge campi: la versione si legge prima del resto.
    value["campo_futuro"] = true.into();
    value["blocks"][0]["nuovo"] = 1.into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Version(4))
    );
    value["version"] = 3.into();
    value["opaque_schema"] = 999.into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::OpaqueSchema(999))
    );
    value["opaque_schema"] = OPAQUE_SCHEMA.into();
    value.as_object_mut().unwrap().remove("campo_futuro");
    value["blocks"][0].as_object_mut().unwrap().remove("nuovo");
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
fn la_proiezione_dichiara_lo_schema_dei_dati_opachi() {
    let file = bytes(&sample());
    let opened = open(Codec::Docx, &file).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&opened.projection).unwrap();
    assert_eq!(value["version"], fub_format_rich::projection::VERSION);
    assert_eq!(value["opaque_schema"], OPAQUE_SCHEMA);
    let edited = |value: &serde_json::Value| {
        let mut p = Projection::from_json(&value.to_string()).unwrap();
        let Inline::Text { x, .. } = &mut para_mut(&mut p, 1).c[0] else {
            panic!()
        };
        x.push_str(" e ancora");
        p.to_json().unwrap()
    };
    assert!(matches!(
        save(Codec::Docx, &file, &edited(&value)),
        Ok(Saved::Bytes(_))
    ));
    // Una bozza di versione 2, di prima dei segni della 3, si salva.
    value["version"] = 2.into();
    assert!(matches!(
        save(Codec::Docx, &file, &edited(&value)),
        Ok(Saved::Bytes(_))
    ));

    // Uno schema più nuovo non si legge, nemmeno in parte.
    value["opaque_schema"] = (OPAQUE_SCHEMA + 1).into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::OpaqueSchema(OPAQUE_SCHEMA + 1))
    );
    // Una versione con lo schema, senza lo schema, è malformata.
    value.as_object_mut().unwrap().remove("opaque_schema");
    assert!(matches!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Malformed(_))
    ));
    // La versione 1, quella delle bozze di prima, ha lo schema 0 e si salva.
    value["version"] = 1.into();
    let v1 = Projection::from_json(&value.to_string()).unwrap();
    assert_eq!(v1.schema(), 0);
    assert!(matches!(
        save(Codec::Docx, &file, &edited(&value)),
        Ok(Saved::Bytes(_))
    ));
    // Ma non dichiara uno schema.
    value["opaque_schema"] = 0.into();
    assert!(matches!(
        save(Codec::Docx, &file, &value.to_string()),
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
    let last = d.body.len() - 1;
    let file = bytes(&d);
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Projection));
    // «Che cosa manca?» dice il paragrafo dei rimandi.
    assert_eq!(
        Projection::from_json(&opened.projection).unwrap().missing,
        [Missing {
            what: MissingWhat::Changed,
            block: Some(last),
        }]
    );
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    assert_eq!(projection.readonly, Some(ReadOnly::Projection));
    // Una modifica si rifiuta con il motivo misurato all'apertura; e chi
    // togliesse quel campo trova comunque la rilettura a dire di no.
    para_mut(&mut projection, 0).c.push(Inline::Text {
        ins: None,
        del: None,
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
