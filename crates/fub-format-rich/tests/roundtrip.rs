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

#[path = "roundtrip/apertura.rs"]
mod apertura;
#[path = "roundtrip/commenti.rs"]
mod commenti;
#[path = "roundtrip/formato.rs"]
mod formato;
#[path = "roundtrip/inchiostro.rs"]
mod inchiostro;
#[path = "roundtrip/limiti.rs"]
mod limiti;
#[path = "roundtrip/oggetti.rs"]
mod oggetti;
#[path = "roundtrip/pagine.rs"]
mod pagine;
#[path = "roundtrip/revisioni.rs"]
mod revisioni;
#[path = "roundtrip/tabelle.rs"]
mod tabelle;

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

fn rev(by: &str) -> Option<fub_format_rich::projection::Rev> {
    Some(fub_format_rich::projection::Rev {
        by: by.into(),
        at: "2026-10-18T10:00:00Z".into(),
        mv: None,
    })
}
