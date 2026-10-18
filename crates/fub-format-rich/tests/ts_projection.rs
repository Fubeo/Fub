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
use fub_format_rich::projection::{
    Align, AtomKind, Block, Inline, Layout, Line, Look, Mark, Projection, Role,
};
use fub_format_rich::{open, save, Codec, Saved};
use serde_json::{json, Value};
use wordcraft_doc::{
    para_block, CharProps, Comment, Document, InlineObject, Paragraph, PartKind, Revision,
    RevisionKind, SectionProps,
};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__")
        .join(name)
}

/// L'esempio comune, con ciò che serve in più alla superficie: un salto
/// pagina in un paragrafo, la fine di una sezione, un paragrafo con
/// revisioni tracciate, uno con un commento e un ultimo paragrafo.
fn document() -> Document {
    let mut d = sample();
    d.body.push(para_block(text(
        "Prima\u{c}dopo il salto",
        CharProps::default(),
    )));
    let mut end = text("Fine della prima sezione", CharProps::default());
    end.section = Some(Box::new(SectionProps::default()));
    d.body.push(para_block(end));
    d.revisions = vec![
        Revision::new(RevisionKind::Insert, "Ada", "2026-10-18T10:00:00Z"),
        Revision::new(RevisionKind::Delete, "Bea", "2026-10-18T11:00:00Z"),
    ];
    let mut tracked = Paragraph::new();
    tracked.mark.ins = Some(0);
    for (piece, ins, del) in [
        ("Revisione: ", None, None),
        ("nuova", Some(0), None),
        (" ", None, None),
        ("vecchia", None, Some(1)),
    ] {
        let props = CharProps {
            ins,
            del,
            ..Default::default()
        };
        let at = tracked.len();
        tracked.insert_text(at, piece, &props).unwrap();
    }
    d.body.push(para_block(tracked));
    // Un commento su «questo passo», con una risposta.
    for (id, author, said, parent) in [
        (1, "Redazione", "Da rivedere.", None),
        (2, "Ada", "Fatto.", Some(1)),
    ] {
        let part = d.add_part(
            PartKind::Comment,
            vec![para_block(text(said, CharProps::default()))],
        );
        d.comments.insert(
            id,
            Comment {
                author: author.into(),
                date: "2026-10-18T12:00:00Z".into(),
                parent,
                part,
                ..Default::default()
            },
        );
    }
    let mut commented = text("Commento: questo passo.", CharProps::default());
    let start = "Commento: ".len();
    commented
        .insert_object(
            start,
            InlineObject::CommentStart { id: 1 },
            &CharProps::default(),
        )
        .unwrap();
    let end = commented.len() - 1;
    commented
        .insert_object(
            end,
            InlineObject::CommentEnd { id: 1 },
            &CharProps::default(),
        )
        .unwrap();
    d.body.push(para_block(commented));
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
    // L'aspetto messo su «dalla shell».
    let Block::Para(para) = &p.blocks[1] else {
        unreachable!()
    };
    let styled = para
        .c
        .iter()
        .find_map(|i| match i {
            Inline::Text { x, m, f, .. } if x == "dalla shell" => Some((m.clone(), f.clone())),
            _ => None,
        })
        .expect("il tratto con l'aspetto della shell");
    assert_eq!(
        styled,
        (
            vec![Mark::H, Mark::SmallCaps],
            Look {
                font: Some("Courier New".into()),
                size: Some(18.0),
                color: Some("#c00000".into()),
                hl: Some("#00ffff".into()),
            }
        )
    );
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
    // E la colonna aggiunta: tre celle in ogni riga, con le proprietà.
    assert!(table
        .rows
        .iter()
        .all(|row| row.cells.len() == 3 && row.cells.iter().all(|c| c.k.is_some())));
    // La tabella nuova, dopo il paragrafo del salto: ora ha le sue proprietà.
    let fresh = p
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Table(table) => Some(table),
            _ => None,
        })
        .nth(1)
        .expect("la tabella nuova");
    assert_eq!(fresh.rows.len(), 2);
    // La prima cella copre due colonne: due celle nella prima riga, tre
    // nell'altra.
    let shape: Vec<Vec<Option<u32>>> = fresh
        .rows
        .iter()
        .map(|row| row.cells.iter().map(|c| c.span).collect())
        .collect();
    assert_eq!(shape, [vec![Some(2), None], vec![None, None, None]]);
    assert!(fresh.k.is_some() && fresh.rows[1].cells[2].k.is_some());
    let Block::Para(first) = &fresh.rows[0].cells[0].blocks[0] else {
        panic!("la prima cella")
    };
    assert!(matches!(&first.c[..], [Inline::Text { x, .. }] if x == "nuova"));
    // La prosa torna alla prima riga dello stile e tiene lo spazio dopo.
    assert_eq!(
        para_of(&p, "Una prosa").p,
        Layout {
            after: Some(14.0),
            ..Layout::default()
        }
    );
    // I link: uno cambiato, uno nuovo che prende lo stile dei collegamenti.
    let href = |text: &str| {
        para_of(&p, text).c.iter().find_map(|i| match i {
            Inline::Text { x, href, .. } if x == text => href.clone(),
            _ => None,
        })
    };
    assert_eq!(href("link").as_deref(), Some("https://fub.app/nuovo"));
    assert_eq!(href("Prima").as_deref(), Some("https://fub.app/prima"));
    // Le revisioni della shell: l'inserimento accettato resta testo,
    // l'eliminazione accettata se ne va; il segno di fine inserito resta.
    let tracked = para_of(&p, "Revisione");
    assert_eq!(tracked.ins.as_ref().map(|rev| rev.by.as_str()), Some("Ada"));
    assert!(matches!(
        &tracked.c[..],
        [Inline::Text { x, ins: None, del: None, .. }] if x == "Revisione: nuova "
    ));
    // I commenti della shell: una risposta e il filo risolto, un commento
    // nuovo su «Fine»; riletti, sono commenti come gli altri.
    let comments: Vec<_> = p
        .comments
        .iter()
        .map(|c| {
            (
                c.id,
                c.by.as_str(),
                c.parent,
                c.done,
                c.text.as_str(),
                c.k.is_some(),
            )
        })
        .collect();
    assert_eq!(
        comments,
        [
            (1, "Redazione", None, true, "Da rivedere.", true),
            (2, "Ada", Some(1), true, "Fatto.", true),
            (3, "Bea", Some(1), true, "Risposta\ndella shell.", true),
            (4, "Bea", None, false, "Un commento nuovo.", true),
        ]
    );
    let anchors = |para: &fub_format_rich::projection::Para| -> Vec<(u32, bool)> {
        para.c
            .iter()
            .filter_map(|i| match i {
                Inline::Atom { comment, .. } => comment.map(|a| (a.id, a.end)),
                _ => None,
            })
            .collect()
    };
    assert_eq!(
        anchors(para_of(&p, "questo passo")),
        [(1, false), (3, false), (1, true), (3, true)]
    );
    let Some(Block::Para(last)) = p.blocks.last() else {
        panic!("l'ultimo blocco non è un paragrafo");
    };
    assert_eq!(anchors(last), [(4, false), (4, true)]);
    // Il paragrafo del salto ha lo stile Sottotitolo.
    assert_eq!(para_of(&p, "dopo il salto").s.as_deref(), Some("Subtitle"));
    // In fondo al paragrafo del salto: l'immagine e le due note della shell,
    // ora tenute come ogni altro oggetto.
    let shell: Vec<(AtomKind, bool)> = para_of(&p, "dopo il salto")
        .c
        .iter()
        .filter_map(|i| match i {
            Inline::Atom { kind, k, .. } => Some((*kind, k.is_some())),
            _ => None,
        })
        .collect();
    assert_eq!(
        shell,
        [
            (AtomKind::Image, true),
            (AtomKind::Note, true),
            (AtomKind::Note, true)
        ]
    );
    let document = wordcraft_docx::read(&out).unwrap();
    let story = |kind: PartKind| {
        document
            .parts
            .values()
            .filter(|part| part.kind == kind)
            .map(|part| part.blocks[0].as_para().unwrap().plain_text())
            .collect::<Vec<_>>()
    };
    assert!(story(PartKind::Footnote)
        .iter()
        .any(|t| t.ends_with(" Una nota della shell.")));
    assert!(story(PartKind::Endnote)
        .iter()
        .any(|t| t.ends_with(" In chiusura.")));
    assert!(document
        .media
        .values()
        .any(|bytes| bytes.as_slice() == common::PNG));
    // Il paragrafo della sezione: centrato, rientrato, interlinea e spazio.
    let section = para_of(&p, "Fine della prima sezione");
    assert_eq!(section.align, Some(Align::Center));
    assert_eq!(
        section.p,
        Layout {
            left: Some(36.0),
            before: Some(6.0),
            line: Some(Line::Multiple(1.5)),
            ..Layout::default()
        }
    );
    // Registrando, Bea ha scritto in fondo alla sezione: un suo inserimento.
    assert!(p.track, "il documento registra le modifiche");
    assert!(section.c.iter().any(|inline| matches!(
        inline,
        Inline::Text { x, ins: Some(rev), .. } if x == " rivista" && rev.by == "Bea"
    )));
    // La prima sezione è girata, con due colonne; l'ultima ha i margini stretti.
    let page = section
        .page
        .as_deref()
        .expect("la pagina della prima sezione");
    assert!(page.w > page.h, "{page:?}");
    assert_eq!(page.cols, 2);
    let last = p.page.expect("la pagina dell'ultima sezione");
    assert_eq!(
        (last.top, last.bottom, last.left, last.right),
        (36.0, 36.0, 36.0, 36.0)
    );
    // L'ultimo paragrafo è un titolo di secondo livello, e la sezione resta.
    let (role, last, _) = plain(&p.blocks, p.blocks.len() - 1);
    assert_eq!((role, last.as_str()), (Role::Heading { level: 2 }, "Fine."));
    assert!(p
        .blocks
        .iter()
        .any(|b| matches!(b, Block::Para(para) if para.sect.is_some())));
}

/// Il paragrafo del documento che contiene `text`.
fn para_of<'a>(p: &'a Projection, text: &str) -> &'a fub_format_rich::projection::Para {
    p.blocks
        .iter()
        .find_map(|b| match b {
            Block::Para(para)
                if para
                    .c
                    .iter()
                    .any(|i| matches!(i, Inline::Text { x, .. } if x.contains(text))) =>
            {
                Some(para)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("il paragrafo con «{text}»"))
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
