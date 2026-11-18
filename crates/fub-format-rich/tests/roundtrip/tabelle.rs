//! Tabelle: celle scritte, tabelle nuove, colonne aggiunte o tolte, celle unite
//! o divise.

use super::*;

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

/// La disposizione che la shell dà ai paragrafi di una tabella nuova
/// (`insertTable`): spazio dopo 0 e interlinea singola, come la griglia di
/// Word.
fn cell_layout() -> Layout {
    Layout {
        after: Some(0.0),
        line: Some(Line::Multiple(1.0)),
        ..Layout::default()
    }
}

/// I paragrafi delle celle della tabella `table`.
fn cell_paras(table: &Table) -> impl Iterator<Item = &Para> {
    table
        .rows
        .iter()
        .flat_map(|row| &row.cells)
        .flat_map(|cell| &cell.blocks)
        .map(|block| match block {
            Block::Para(para) => para,
            Block::Table(_) => panic!("una tabella annidata"),
        })
}

/// Inserisci › Tabella in un documento con la spaziatura di serie di Word (8
/// punti dopo, interlinea 1,15): le celle si scrivono con la loro
/// disposizione, riaperte la hanno uguale e si salvano senza cambiare; la
/// copia RTF la porta.
#[test]
fn le_celle_di_una_tabella_nuova_si_rileggono_con_la_spaziatura_della_griglia() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    let mut fresh = new_table(2, 2);
    let Block::Table(table) = &mut fresh else {
        unreachable!()
    };
    for row in &mut table.rows {
        for cell in &mut row.cells {
            let Block::Para(para) = &mut cell.blocks[0] else {
                unreachable!()
            };
            para.p = cell_layout();
        }
    }
    p.blocks.insert(1, fresh);
    let out = saved(&file, &p);
    let after = read(&out);
    let WcBlock::Table(written) = &*after.body[1] else {
        panic!("non è una tabella")
    };
    for cell in written.rows.iter().flat_map(|row| &row.cells) {
        let props = &cell.blocks[0].as_para().unwrap().props;
        assert_eq!(props.space_after, Some(0.0));
        assert_eq!(props.line_spacing, Some(LineSpacing::Multiple(1.0)));
    }
    let reopened = projection(&out);
    let Block::Table(table) = &reopened.blocks[1] else {
        panic!("non è una tabella")
    };
    assert_eq!(cell_paras(table).count(), 4);
    assert!(cell_paras(table).all(|para| para.p == cell_layout()));
    // Il paragrafo dopo la tabella resta con la sua disposizione.
    assert_eq!(
        para_mut(&mut reopened.clone(), 2).p,
        para_mut(&mut projection(&file), 1).p
    );
    assert!(matches!(
        save(Codec::Docx, &out, &reopened.to_json().unwrap()),
        Ok(Saved::Unchanged)
    ));

    // La copia RTF: l'esportatore non scrive spaziature, e quelle di serie
    // dell'RTF sono già spazio dopo 0 e interlinea singola, quindi la
    // proiezione non le porta; riletta, ogni cella ha quella della griglia.
    let rtf = wordcraft_formats::rtf::export(&after);
    let opened = open(Codec::Rtf, rtf.as_bytes()).unwrap();
    let imported = Projection::from_json(&opened.projection).unwrap();
    let Some(Block::Table(table)) = imported.blocks.get(1) else {
        panic!("la tabella nuova nella copia RTF")
    };
    assert_eq!(cell_paras(table).count(), 4);
    let model = wordcraft_formats::rtf::import(rtf.as_bytes()).unwrap();
    let WcBlock::Table(table) = &*model.body[1] else {
        panic!("non è una tabella")
    };
    for cell in table.rows.iter().flat_map(|row| &row.cells) {
        let props = &cell.blocks[0].as_para().unwrap().props;
        let shown = model.styles.resolve_para(props);
        assert_eq!(
            (shown.space_after, shown.line_spacing),
            (0.0, LineSpacing::Multiple(1.0))
        );
    }
}
