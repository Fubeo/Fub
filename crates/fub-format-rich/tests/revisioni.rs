//! Le revisioni tracciate scritte dalla shell: un documento che registrava già
//! le modifiche all'apertura riceve inserimenti senza un autore, e il
//! salvataggio deve riuscire lo stesso.

use fub_format_rich::projection::{Block, Inline, Projection};
use fub_format_rich::{open, save, Codec, Saved};

const REVISIONI: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/corpus/docx/revisioni-testo.docx"
);

fn projection(bytes: &[u8]) -> Projection {
    let opened = open(Codec::Docx, bytes).unwrap();
    assert_eq!(
        opened.readonly, None,
        "il documento deve essere modificabile"
    );
    Projection::from_json(&opened.projection).unwrap()
}

/// Il primo paragrafo, come lo vede la superficie.
fn first(projection: &mut Projection) -> &mut Vec<Inline> {
    match &mut projection.blocks[0] {
        Block::Para(para) => &mut para.c,
        Block::Table(_) => panic!("il primo blocco è una tabella"),
    }
}

/// Un tratto scritto con le revisioni accese, come lo manda la shell.
fn typed(rev: serde_json::Value) -> Inline {
    serde_json::from_value(serde_json::json!({
        "t": "text", "x": "Q", "k": "e30", "m": ["b"], "ins": rev,
    }))
    .unwrap()
}

#[test]
fn un_inserimento_senza_autore_si_salva_e_si_rilegge_come_quello_di_word() {
    let original = std::fs::read(REVISIONI).unwrap();
    let mut wanted = projection(&original);
    assert!(wanted.track, "il file del corpus registra le modifiche");
    first(&mut wanted).push(typed(serde_json::json!({ "at": "2026-11-17T10:00:00Z" })));
    let out = match save(Codec::Docx, &original, &wanted.to_json().unwrap()).unwrap() {
        Saved::Bytes(out) => out,
        Saved::Unchanged => panic!("il salvataggio non ha scritto niente"),
    };
    let mut back = projection(&out);
    let last = first(&mut back).last().cloned().unwrap();
    let Inline::Text { x, ins, .. } = last else {
        panic!("l'ultimo tratto non è testo: {last:?}");
    };
    assert_eq!(x, "Q");
    let ins = ins.expect("la Q resta un inserimento");
    assert_eq!(ins.by, "Unknown");
    assert_eq!(ins.at, "2026-11-17T10:00:00Z");
}

#[test]
fn un_inserimento_con_l_autore_lo_conserva() {
    let original = std::fs::read(REVISIONI).unwrap();
    let mut wanted = projection(&original);
    first(&mut wanted).push(typed(
        serde_json::json!({ "by": "Ada", "at": "2026-11-17T10:00:00Z" }),
    ));
    let Saved::Bytes(out) = save(Codec::Docx, &original, &wanted.to_json().unwrap()).unwrap()
    else {
        panic!("il salvataggio non ha scritto niente");
    };
    let mut back = projection(&out);
    let Some(Inline::Text { ins: Some(ins), .. }) = first(&mut back).last().cloned() else {
        panic!("l'ultimo tratto non è un inserimento");
    };
    assert_eq!(ins.by, "Ada");
}
