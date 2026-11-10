//! Inchiostro e disegni: penne, tratti nuovi, disegni SVG con il loro PNG.

use super::*;

/// Un tratto d'inchiostro di tre punti, con la pressione.
fn ink_shape() -> fub_format_rich::projection::InkShape {
    fub_format_rich::projection::InkShape {
        strokes: vec![fub_format_rich::projection::InkLine {
            color: "#0072b2".into(),
            width: 2.0,
            hl: false,
            xy: vec![0.0, 0.0, 30.0, 10.0, 60.0, 30.0],
            p: vec![0.25, 0.5, 0.75],
            pen: Some("fountain".into()),
        }],
    }
}

#[test]
fn le_penne_diventano_le_proprietà_del_pennello_di_word() {
    use fub_format_rich::projection::InkLine;
    use fub_ink::inkml::InkTip;
    let line = |pen: Option<&str>, hl: bool| InkLine {
        color: "#000000".into(),
        width: 6.0,
        hl,
        xy: vec![0.0, 0.0, 10.0, 0.0],
        p: Vec::new(),
        pen: pen.map(str::to_owned),
    };
    let calligraphy = line(Some("calligraphy"), false).brush();
    assert_eq!(
        (calligraphy.tip, calligraphy.width, calligraphy.height),
        (InkTip::Rectangle, 6.0, 1.0)
    );
    assert_eq!(calligraphy.pen.as_deref(), Some("calligraphy"));
    let marker = line(Some("marker"), false).brush();
    assert!(marker.ignore_pressure);
    assert_eq!(marker.tip, InkTip::Ellipse);
    let plain = line(None, false).brush();
    assert!(!plain.ignore_pressure && plain.pen.is_none());
    // L'evidenziatore resta quello di Word, punta rettangolare, senza penna.
    let highlighter = line(Some("highlighter"), true).brush();
    assert_eq!(
        (highlighter.tip, highlighter.highlighter, highlighter.pen),
        (InkTip::Rectangle, true, None)
    );
}

fn new_atom(
    kind: AtomKind,
    ink: Option<fub_format_rich::projection::InkShape>,
    svg: Option<String>,
    float: Option<fub_format_rich::projection::Place>,
) -> Inline {
    Inline::Atom {
        ins: None,
        del: None,
        k: None,
        kind,
        label: "a mano".into(),
        w: Some(60.0),
        h: Some(30.0),
        data: Some(base64::engine::general_purpose::STANDARD.encode(PNG)),
        note: None,
        end: false,
        toc: None,
        comment: None,
        ink,
        svg,
        float,
    }
}

const SCENE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 60 30" width="60" height="30"><rect x="1" y="1" width="20" height="10"/></svg>"#;

#[test]
fn un_inchiostro_nuovo_si_scrive_come_quello_di_word_e_torna_modificabile() {
    use fub_format_rich::projection::{Place, PlaceWrap};
    let file = bytes(&sample());
    let mut p = projection(&file);
    let place = Place {
        wrap: PlaceWrap::Front,
        x: 12.0,
        y: 4.0,
    };
    para_mut(&mut p, 1).c.push(new_atom(
        AtomKind::Ink,
        Some(ink_shape()),
        None,
        Some(place),
    ));
    let out = saved(&file, &p);
    let after = read(&out);
    let ink = paragraph(&after, 1)
        .objects
        .iter()
        .find_map(|o| match o {
            InlineObject::Graphic { graphic, float, .. } => Some((graphic.clone(), float.clone())),
            _ => None,
        })
        .expect("l'inchiostro è un oggetto di Word");
    assert_eq!(ink.0.kind, wordcraft_doc::graphic::GraphicKind::Ink);
    assert_eq!(ink.1.wrap, wordcraft_doc::para::Wrap::InFrontOfText);
    let markup = wordcraft_docx::ink::ink_markup(&after, &ink.0).expect("la parte InkML");
    assert!(String::from_utf8_lossy(markup).contains("<ink"));
    // Riaperto, è un inchiostro coi suoi tratti, al suo posto.
    let mut back = projection(&out);
    let Some(Inline::Atom {
        kind: AtomKind::Ink,
        ink: Some(shape),
        float,
        data,
        ..
    }) = para_mut(&mut back, 1).c.last().cloned()
    else {
        panic!("{:?}", para_mut(&mut back, 1).c.last())
    };
    assert_eq!(float, Some(place));
    assert!(data.is_some(), "l'immagine di ripiego si vede");
    assert_eq!(shape.strokes.len(), 1);
    assert_eq!(shape.strokes[0].color, "#0072b2");
    assert_eq!(shape.strokes[0].xy.len(), 6);
    assert_eq!(shape.strokes[0].p.len(), 3);
    // La penna torna con lui; Word la ignora.
    assert!(String::from_utf8_lossy(markup).contains("name=\"fubPen\" value=\"fountain\""));
    assert_eq!(shape.strokes[0].pen.as_deref(), Some("fountain"));
    // Spostarlo in linea lo mette in linea, e il resto resta.
    if let Some(Inline::Atom { float, .. }) = para_mut(&mut back, 1).c.last_mut() {
        *float = None;
    }
    let moved = read(&saved(&out, &back));
    assert!(paragraph(&moved, 1).objects.iter().any(|o| matches!(
        o,
        InlineObject::Graphic { float, .. } if float.wrap == wordcraft_doc::para::Wrap::Inline
    )));
}

/// Tre PNG di un pixel, blu, arancio e verde.
const BLUE: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgKNr0HwADvgIkzAHEiwAAAABJRU5ErkJggg==";
const ORANGE: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4GsfwHwAFcgIzrfxWtAAAAABJRU5ErkJggg==";
const GREEN: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgmFf8HwADxAIRcGHz3wAAAABJRU5ErkJggg==";

fn bytes_of(saved: Result<Saved, RichError>, which: &str) -> Vec<u8> {
    match saved {
        Ok(Saved::Bytes(out)) => out,
        other => panic!("{which} inchiostro: {other:?}"),
    }
}

/// Il primo paragrafo che si modifica.
fn first_para(projection: &Projection) -> usize {
    projection
        .blocks
        .iter()
        .position(|b| matches!(b, Block::Para(para) if !para.locked))
        .expect("un paragrafo aperto")
}

#[test]
fn un_inchiostro_nuovo_si_innesta_in_un_file_che_il_codec_non_riscrive_intero() {
    // `oggetti.docx` ha forme e caselle che il codec non riscrive: il
    // salvataggio è un innesto, che dà all'inchiostro relazioni e `docPr`
    // liberi nel file, non quelli del codec. Ogni inchiostro ha i suoi
    // tratti e la sua immagine di ripiego, come quelli veri.
    let ink = |png: &str, lift: f32| {
        let mut shape = ink_shape();
        shape.strokes[0].xy[5] += lift;
        let mut atom = new_atom(AtomKind::Ink, Some(shape), None, None);
        if let Inline::Atom { data, .. } = &mut atom {
            *data = Some(png.into());
        }
        atom
    };
    let file = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/docx/oggetti.docx"),
    )
    .unwrap();
    let mut p = projection(&file);
    let at = first_para(&p);
    para_mut(&mut p, at).c.push(ink(BLUE, 0.0));
    let out = bytes_of(save(Codec::Docx, &file, &p.to_json().unwrap()), "il primo");
    let mut back = projection(&out);
    let at = first_para(&back);
    assert!(
        para_mut(&mut back, at).c.iter().any(|i| matches!(
            i,
            Inline::Atom {
                kind: AtomKind::Ink,
                ink: Some(_),
                ..
            }
        )),
        "riaperto, è un inchiostro"
    );
    assert_eq!(
        save(Codec::Docx, &out, &back.to_json().unwrap()),
        Ok(Saved::Unchanged)
    );
    // Un secondo, dopo il primo già innestato.
    para_mut(&mut back, at).c.push(ink(ORANGE, 12.0));
    let again = bytes_of(
        save(Codec::Docx, &out, &back.to_json().unwrap()),
        "il secondo",
    );
    let inks = read(&again)
        .body
        .iter()
        .filter_map(|b| b.as_para())
        .flat_map(|p| p.objects.iter())
        .filter(|o| matches!(o, InlineObject::Graphic { graphic, .. } if graphic.kind == wordcraft_doc::graphic::GraphicKind::Ink))
        .count();
    assert_eq!(inks, 2);
    // Il primo tolto e un terzo aggiunto: le parti del primo se ne vanno.
    let count = |bytes: &[u8]| {
        read(bytes)
            .body
            .iter()
            .filter_map(|b| b.as_para())
            .flat_map(|p| p.objects.iter())
            .filter(|o| matches!(o, InlineObject::Graphic { graphic, .. } if graphic.kind == wordcraft_doc::graphic::GraphicKind::Ink))
            .count()
    };
    let mut third = projection(&again);
    let at = first_para(&third);
    let first = para_mut(&mut third, at)
        .c
        .iter()
        .position(|i| {
            matches!(
                i,
                Inline::Atom {
                    kind: AtomKind::Ink,
                    ..
                }
            )
        })
        .expect("il primo inchiostro");
    para_mut(&mut third, at).c.remove(first);
    para_mut(&mut third, at).c.push(ink(GREEN, 24.0));
    let swapped = bytes_of(
        save(Codec::Docx, &again, &third.to_json().unwrap()),
        "il terzo",
    );
    assert_eq!(count(&swapped), 2);
    // Lo stesso inchiostro mandato di nuovo come nuovo, al posto di quello
    // salvato: l'innesto riprende le parti uguali che il file ha già.
    let mut resent = projection(&swapped);
    let at = first_para(&resent);
    let last = para_mut(&mut resent, at)
        .c
        .iter()
        .rposition(|i| {
            matches!(
                i,
                Inline::Atom {
                    kind: AtomKind::Ink,
                    ..
                }
            )
        })
        .expect("il terzo inchiostro");
    para_mut(&mut resent, at).c.remove(last);
    para_mut(&mut resent, at).c.push(ink(GREEN, 24.0));
    let swapped = bytes_of(
        save(Codec::Docx, &swapped, &resent.to_json().unwrap()),
        "lo stesso",
    );
    assert_eq!(count(&swapped), 2);
    let reopened = open(Codec::Docx, &swapped).unwrap();
    assert_eq!(reopened.readonly, None);
    // E togliere soltanto.
    let mut fewer = projection(&swapped);
    let at = first_para(&fewer);
    para_mut(&mut fewer, at).c.retain(|i| {
        !matches!(
            i,
            Inline::Atom {
                kind: AtomKind::Ink,
                ..
            }
        )
    });
    let none = bytes_of(
        save(Codec::Docx, &swapped, &fewer.to_json().unwrap()),
        "nessun",
    );
    assert_eq!(count(&none), 0);
}

#[test]
fn un_disegno_nuovo_è_un_svg_col_suo_png_e_si_riapre_da_modificare() {
    let file = bytes(&sample());
    let mut p = projection(&file);
    para_mut(&mut p, 1)
        .c
        .push(new_atom(AtomKind::Drawing, None, Some(SCENE.into()), None));
    let out = saved(&file, &p);
    let mut back = projection(&out);
    let Some(Inline::Atom {
        kind: AtomKind::Drawing,
        svg: Some(svg),
        data: Some(_),
        ..
    }) = para_mut(&mut back, 1).c.last().cloned()
    else {
        panic!("{:?}", para_mut(&mut back, 1).c.last())
    };
    assert_eq!(svg, SCENE);
    // Un SVG che non è di FubDraw resta un'immagine.
    let mut q = projection(&file);
    let foreign = SCENE.replace(
        "https://fubeo.github.io/ns/scene/1",
        "https://example.org/x",
    );
    para_mut(&mut q, 1)
        .c
        .push(new_atom(AtomKind::Drawing, None, Some(foreign), None));
    let mut back = projection(&saved(&file, &q));
    assert!(matches!(
        para_mut(&mut back, 1).c.last(),
        Some(Inline::Atom {
            kind: AtomKind::Image,
            svg: None,
            ..
        })
    ));
}

#[test]
fn un_inchiostro_o_un_disegno_senza_i_suoi_dati_è_rifiutato() {
    let file = bytes(&sample());
    for atom in [
        new_atom(AtomKind::Ink, None, None, None),
        new_atom(AtomKind::Drawing, None, None, None),
        new_atom(AtomKind::Ink, Some(ink_shape()), Some(SCENE.into()), None),
    ] {
        let mut p = projection(&file);
        para_mut(&mut p, 1).c.push(atom);
        let result = save(Codec::Docx, &file, &p.to_json().unwrap());
        assert!(matches!(result, Err(RichError::Malformed(_))), "{result:?}");
    }
}
