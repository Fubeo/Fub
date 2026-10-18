//! Il documento d'esempio dei test: lo stesso per i giri attraverso il codec
//! (`roundtrip.rs`) e per le fixture della shell (`ts_projection.rs`).

#![allow(dead_code)]

use wordcraft_doc::numbering::ListKind;
use wordcraft_doc::para::NoteKind;
use wordcraft_doc::props::NumRef;
use wordcraft_doc::{
    para_block, Block as WcBlock, CharProps, Document, InlineObject, Paragraph, Table,
};

/// Un PNG di un pixel.
pub const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

pub fn text(t: &str, props: CharProps) -> Paragraph {
    Paragraph::with_text(t, props)
}

pub fn styled(t: &str, style: &str) -> Paragraph {
    text(t, CharProps::default()).styled(style)
}

/// Un documento con un po' di tutto: titolo, prosa con enfasi e link, un
/// elenco, una tabella, un'immagine e una nota.
pub fn sample() -> Document {
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

pub fn bytes(document: &Document) -> Vec<u8> {
    wordcraft_docx::write(document).unwrap()
}
