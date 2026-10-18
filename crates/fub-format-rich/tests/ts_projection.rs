//! Le due fixture che legano la proiezione della shell a quella del codec, nei
//! due versi.
//!
//! - `rich-projection.json` è la proiezione che il codec dà di un `.docx` con
//!   un po' di tutto: la shell la legge, la riscrive identica senza modifiche
//!   e ci lavora sopra (`apps/client/src/editors/rich/*.test.ts`). La scrive
//!   questo file con `UPDATE_MIRROR=1`.
//! - `rich-edited.json` è la stessa proiezione dopo le modifiche che il test
//!   della shell fa con i suoi comandi. La scrive la shell come snapshot
//!   (`npx vitest run src/editors/rich/fixture.test.ts -u`), e qui si salva sui byte
//!   di partenza: ciò che la superficie scrive, il codec lo accetta e lo
//!   rilegge com'era voluto.
//!
//! Rigenerare la prima rende stantia la seconda: il test della shell lo dice.

mod common;

use std::path::PathBuf;

use common::{bytes, sample, text};
use fub_format_rich::projection::{Block, Inline, Mark, Projection, Role};
use fub_format_rich::{open, save, Codec, Saved};
use serde_json::{json, Value};
use wordcraft_doc::{para_block, CharProps, Document, SectionProps};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__")
        .join(name)
}

/// L'esempio comune, con ciò che serve in più alla superficie: un salto
/// pagina in un paragrafo, la fine di una sezione e un ultimo paragrafo.
fn document() -> Document {
    let mut d = sample();
    d.body.push(para_block(text(
        "Prima\u{c}dopo il salto",
        CharProps::default(),
    )));
    let mut end = text("Fine della prima sezione", CharProps::default());
    end.section = Some(Box::new(SectionProps::default()));
    d.body.push(para_block(end));
    d.body.push(para_block(text("Fine.", CharProps::default())));
    d
}

fn source_of(name: &str) -> String {
    let path = fixture(name);
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    let value: Value = serde_json::from_str(&raw).expect("fixture JSON");
    value["source"].as_str().expect("campo source").to_string()
}

#[test]
fn la_fixture_della_shell_è_la_proiezione_del_codec() {
    let opened = open(Codec::Docx, &bytes(&document())).unwrap();
    assert_eq!(opened.readonly, None, "l'esempio si deve poter modificare");
    let path = fixture("rich-projection.json");
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        let mut out =
            serde_json::to_string_pretty(&json!({ "source": opened.projection })).unwrap();
        out.push('\n');
        std::fs::write(&path, out).expect("scrive la fixture");
        return;
    }
    assert_eq!(
        source_of("rich-projection.json"),
        opened.projection,
        "la fixture della shell è stantia: rigenerala con \
         `UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_projection`, \
         poi rigenera `rich-edited.json` dalla shell"
    );
}

fn plain(blocks: &[Block], index: usize) -> (Role, String, Vec<(String, Vec<Mark>)>) {
    let Block::Para(para) = &blocks[index] else {
        panic!("il blocco {index} è una tabella");
    };
    let mut all = String::new();
    let mut runs = Vec::new();
    for inline in &para.c {
        if let Inline::Text { x, m, .. } = inline {
            all.push_str(x);
            runs.push((x.clone(), m.clone()));
        }
    }
    (para.role, all, runs)
}

#[test]
fn ciò_che_la_superficie_scrive_il_codec_lo_salva() {
    let original = bytes(&document());
    let edited = source_of("rich-edited.json");
    let out =
        match save(Codec::Docx, &original, &edited).expect("la proiezione della shell si salva") {
            Saved::Bytes(out) => out,
            Saved::Unchanged => panic!("le modifiche della shell non hanno scritto niente"),
        };
    let reopened = open(Codec::Docx, &out).unwrap();
    assert_eq!(
        reopened.readonly, None,
        "il documento salvato resta modificabile"
    );
    let p = Projection::from_json(&reopened.projection).unwrap();

    // La parola scritta in fondo al secondo paragrafo.
    let (_, prose, _) = plain(&p.blocks, 1);
    assert!(prose.ends_with("link. Scritto dalla shell."), "{prose}");
    // Il grassetto messo su «Figura».
    let figure = p
        .blocks
        .iter()
        .position(|b| matches!(b, Block::Para(para) if para.c.iter().any(|i| matches!(i, Inline::Text { x, .. } if x.contains("Figura")))))
        .expect("il paragrafo della figura");
    let (_, _, runs) = plain(&p.blocks, figure);
    assert!(
        runs.iter()
            .any(|(x, m)| x == "Figura" && m.contains(&Mark::B)),
        "{runs:?}"
    );
    // Oggetti e nota restano dove erano.
    let Block::Para(para) = &p.blocks[figure] else {
        unreachable!()
    };
    let atoms: Vec<_> = para
        .c
        .iter()
        .filter_map(|i| match i {
            Inline::Atom { kind, .. } => Some(*kind),
            _ => None,
        })
        .collect();
    assert_eq!(atoms.len(), 2, "immagine e nota: {atoms:?}");
    // La riga aggiunta alla tabella.
    let table = p
        .blocks
        .iter()
        .find_map(|b| match b {
            Block::Table(table) => Some(table),
            _ => None,
        })
        .expect("la tabella");
    assert_eq!(table.rows.len(), 3);
    // L'ultimo paragrafo è un titolo di secondo livello, e la sezione resta.
    let (role, last, _) = plain(&p.blocks, p.blocks.len() - 1);
    assert_eq!((role, last.as_str()), (Role::Heading { level: 2 }, "Fine."));
    assert!(p
        .blocks
        .iter()
        .any(|b| matches!(b, Block::Para(para) if para.sect.is_some())));
}

/// Ogni motivo di sola lettura, una volta: il `match` senza ramo di riserva
/// non compila finché un motivo nuovo non entra anche qui.
fn every_read_only_reason() -> Vec<fub_format_rich::ReadOnly> {
    use fub_format_rich::ReadOnly;
    let all = [
        ReadOnly::Revisions,
        ReadOnly::TrackChanges,
        ReadOnly::Protected,
        ReadOnly::Projection,
        ReadOnly::Codec,
        ReadOnly::Import,
    ];
    for reason in all {
        match reason {
            ReadOnly::Revisions
            | ReadOnly::TrackChanges
            | ReadOnly::Protected
            | ReadOnly::Projection
            | ReadOnly::Codec
            | ReadOnly::Import => {}
        }
    }
    all.to_vec()
}

#[test]
fn la_shell_conosce_ogni_motivo_di_sola_lettura() {
    // `READ_ONLY_REASONS` in `projection.ts` è la lista con cui la shell
    // accetta il campo: un motivo che manca lì rende illeggibile la proiezione.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/editors/rich/projection.ts");
    let source = std::fs::read_to_string(&path).unwrap();
    let start = source
        .find("export const READ_ONLY_REASONS")
        .expect("READ_ONLY_REASONS in projection.ts");
    let list = &source[start..start + source[start..].find("];").unwrap()];
    let listed: Vec<&str> = list.split('"').skip(1).step_by(2).collect();
    let wanted: Vec<String> = every_read_only_reason()
        .into_iter()
        .map(|reason| {
            serde_json::to_value(reason)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(listed, wanted, "{}", path.display());
}
