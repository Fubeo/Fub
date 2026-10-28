//! Le proiezioni del banco visivo della shell (`apps/client/bench/`): un
//! `.odt`, un `.docx` pieno di oggetti e uno protetto, aperti dal codec vero.
//! Il `.docx` con un po' di tutto è già `rich-projection.json`
//! (`ts_projection.rs`), e il banco usa quello.
//!
//! La fixture `rich-bench.json` la scrive questo file con `UPDATE_MIRROR=1`;
//! senza, controlla che sia ancora la proiezione del codec.

mod common;

use std::path::PathBuf;

use common::{bytes, sample, styled, text, PNG};
use fub_format_rich::{open, Codec, ReadOnly};
use serde_json::{json, Value};
use wordcraft_doc::numbering::ListKind;
use wordcraft_doc::para::{NoteKind, ShapeKind};
use wordcraft_doc::props::NumRef;
use wordcraft_doc::{
    para_block, Block as WcBlock, CharProps, Document, InlineObject, Paragraph, PartKind,
    SectionProps, Table,
};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/rich-bench.json")
}

fn italic() -> CharProps {
    CharProps {
        italic: Some(true),
        ..Default::default()
    }
}

/// Un paragrafo fatto di pezzi di testo e di oggetti, nell'ordine.
enum Piece {
    Text(&'static str),
    Object(Box<InlineObject>),
}

fn pieces(parts: Vec<Piece>) -> Paragraph {
    let mut p = Paragraph::new();
    for part in parts {
        let at = p.len();
        match part {
            Piece::Text(t) => {
                p.insert_text(at, t, &CharProps::default()).unwrap();
            }
            Piece::Object(object) => {
                p.insert_object(at, *object, &CharProps::default()).unwrap();
            }
        }
    }
    p
}

/// Il verbale di una riunione, come lo scrive un programma OpenDocument:
/// titoli, un elenco numerato e uno puntato, una tabella.
fn verbale() -> Document {
    let mut d = Document::new();
    let numbered = d.numbering.add_list(ListKind::Numbered);
    let bullet = d.numbering.add_list(ListKind::Bullet);
    let mut body = vec![para_block(styled("Verbale della riunione", "Heading1"))];
    let mut when = text("18 ottobre 2026, sala grande. ", CharProps::default());
    let at = when.len();
    when.insert_text(at, "Presenti: Ada, Bea, Carlo.", &italic())
        .unwrap();
    body.push(para_block(when));
    body.push(para_block(styled("Ordine del giorno", "Heading2")));
    for t in [
        "Bilancio del trimestre",
        "Calendario delle uscite",
        "Varie ed eventuali",
    ] {
        let mut li = text(t, CharProps::default());
        li.props.numbering = Some(NumRef {
            num: numbered,
            level: 0,
        });
        body.push(para_block(li));
    }
    body.push(para_block(styled("Decisioni", "Heading2")));
    body.push(para_block(text(
        "Il bilancio si approva all'unanimità. Le uscite di novembre si spostano \
         di una settimana, per dare tempo alla revisione delle bozze.",
        CharProps::default(),
    )));
    for t in ["Ada prepara il calendario", "Bea scrive agli autori"] {
        let mut li = text(t, CharProps::default());
        li.props.numbering = Some(NumRef {
            num: bullet,
            level: 0,
        });
        body.push(para_block(li));
    }
    let rows = [
        ["Chi", "Che cosa", "Entro"],
        ["Ada", "Calendario", "25 ottobre"],
        ["Bea", "Lettere agli autori", "30 ottobre"],
    ];
    let mut table = Table::new(rows.len(), 3, 450.0);
    for (row, cells) in table.rows.iter_mut().zip(rows) {
        for (cell, t) in row.cells.iter_mut().zip(cells) {
            cell.blocks = vec![para_block(text(t, CharProps::default()))];
        }
    }
    body.push(std::sync::Arc::new(WcBlock::Table(table)));
    body.push(para_block(text(
        "La seduta si chiude alle 12:30.",
        CharProps::default(),
    )));
    d.body = body;
    d
}

/// Gli oggetti che la superficie non disegna e tiene com'erano: un'immagine
/// del file, una forma, una casella di testo, una formula, una nota e una
/// nota di chiusura; poi un salto pagina, uno di colonna e una sezione.
fn oggetti() -> Document {
    let mut d = Document::new();
    let media = d.add_media(PNG.to_vec(), "png");
    let story = d.add_part(
        PartKind::TextBox,
        vec![para_block(text("Dentro la casella", CharProps::default()))],
    );
    let foot = d.add_part(
        PartKind::Footnote,
        vec![para_block(text(
            "La nota a piè di pagina.",
            CharProps::default(),
        ))],
    );
    let end = d.add_part(
        PartKind::Endnote,
        vec![para_block(text(
            "La nota di chiusura.",
            CharProps::default(),
        ))],
    );
    let shape = |story: Option<u32>| {
        Box::new(InlineObject::Shape {
            kind: ShapeKind::Rectangle,
            w: 72.0,
            h: 36.0,
            fill: None,
            stroke: None,
            stroke_width: 0.0,
            float: Default::default(),
            story,
            freeform: None,
            effects: Default::default(),
            extra: Default::default(),
        })
    };
    let mut body = vec![para_block(styled("Gli oggetti nel testo", "Heading1"))];
    body.push(para_block(pieces(vec![
        Piece::Text("Un'immagine del file "),
        // 4 × 3 cm.
        Piece::Object(Box::new(InlineObject::Image {
            media,
            w: 113.4,
            h: 85.05,
            alt: "Il cortile".into(),
            float: Default::default(),
            crop: [0.0; 4],
            ole: None,
        })),
        Piece::Text(" e una forma "),
        Piece::Object(shape(None)),
        Piece::Text("."),
    ])));
    body.push(para_block(pieces(vec![
        Piece::Text("Una casella di testo "),
        Piece::Object(shape(Some(story))),
        Piece::Text(" e una formula "),
        Piece::Object(Box::new(InlineObject::Equation {
            linear: "a+b".into(),
            display: false,
            math: Default::default(),
        })),
        Piece::Text("."),
    ])));
    body.push(para_block(pieces(vec![
        Piece::Text("Una nota"),
        Piece::Object(Box::new(InlineObject::NoteRef {
            kind: NoteKind::Footnote,
            id: foot,
            custom: String::new(),
        })),
        Piece::Text(" e una nota di chiusura"),
        Piece::Object(Box::new(InlineObject::NoteRef {
            kind: NoteKind::Endnote,
            id: end,
            custom: String::new(),
        })),
        Piece::Text("."),
    ])));
    body.push(para_block(text(
        "Prima del salto\u{c}dopo il salto pagina",
        CharProps::default(),
    )));
    body.push(para_block(text(
        "Prima colonna\u{e}seconda colonna",
        CharProps::default(),
    )));
    let mut close = text("Fine della prima sezione", CharProps::default());
    close.section = Some(Box::new(SectionProps::default()));
    body.push(para_block(close));
    body.push(para_block(text(
        "La seconda sezione.",
        CharProps::default(),
    )));
    d.body = body;
    d
}

/// L'esempio comune, protetto contro le modifiche.
fn riservato() -> Document {
    let mut d = sample();
    d.settings.protection = Some("readOnly".into());
    d
}

fn projections() -> Value {
    let odt = wordcraft_formats::odt::export(&verbale()).unwrap();
    let opened = open(Codec::Odt, &odt).unwrap();
    assert_eq!(opened.readonly, None, "il verbale si deve poter modificare");
    let verbale = opened.projection;
    let opened = open(Codec::Docx, &bytes(&oggetti())).unwrap();
    assert_eq!(
        opened.readonly, None,
        "gli oggetti si devono poter modificare"
    );
    let oggetti = opened.projection;
    let opened = open(Codec::Docx, &bytes(&riservato())).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Protected));
    let riservato = opened.projection;
    json!({ "odt": verbale, "objects": oggetti, "readonly": riservato })
}

#[test]
fn le_fixture_del_banco_sono_le_proiezioni_del_codec() {
    let fresh = projections();
    let path = fixture();
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        let mut out = serde_json::to_string_pretty(&fresh).unwrap();
        out.push('\n');
        std::fs::write(&path, out).expect("scrive la fixture");
        return;
    }
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let stored: Value = serde_json::from_str(&raw).expect("fixture JSON");
    assert_eq!(
        stored, fresh,
        "la fixture del banco è stantia: rigenerala con \
         `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_bench`"
    );
}
