//! Una bozza che questa versione non sa leggere è comunque testo dell'utente.
//!
//! Il file può venire da una versione più recente di Fub (uno schema che qui non
//! si conosce) o essere rotto. In entrambi i casi la lettura lo conta fra quelli
//! non letti, e né il salvataggio di una nuova bozza né lo scarto dopo un
//! salvataggio riuscito possono farlo sparire: sul supporto vero, non sul banco
//! in memoria.

use fub_abi::rules::doc_data::encode;
use fub_testkit::{doc, Bench, Mounted};

const FUTURE: &str = r#"{"v":99,"doc":"nota.md","at":1,"base":null,"nuovo":"campo","text":"scritto da una versione futura"}"#;

fn draft_file(id: &str) -> String {
    format!(".fub/drafts/{}.json", encode(id))
}

fn with_foreign_draft(bytes: &str) -> Mounted {
    let mounted = Bench::new().with_file("nota.md", "# Nota\n").mounts();
    mounted.write(&draft_file("nota.md"), bytes);
    mounted
}

#[test]
fn a_discard_leaves_a_draft_of_a_newer_version_where_it_is() {
    let mut ws = with_foreign_draft(FUTURE);

    ws.discard_draft(&doc("nota.md"))
        .expect("there is no draft of ours to discard");

    assert_eq!(
        ws.read(&draft_file("nota.md")),
        FUTURE,
        "the draft written by a newer version was deleted without ever being offered"
    );
    assert_eq!(ws.drafts().expect("drafts").pruned, 1);
}

#[test]
fn a_save_moves_a_draft_of_a_newer_version_aside_instead_of_overwriting_it() {
    let mut ws = with_foreign_draft(FUTURE);

    ws.save_draft(&doc("nota.md"), "il buffer di adesso", None)
        .expect("draft saved");

    let read = ws.drafts().expect("drafts");
    let ours: Vec<_> = read
        .drafts
        .iter()
        .map(|d| (d.doc.as_str(), d.text.as_str()))
        .collect();
    assert_eq!(ours, [("nota.md", "il buffer di adesso")]);
    assert_eq!(
        ws.read(&draft_file("nota~recovery.md")),
        FUTURE,
        "the foreign record keeps its bytes under a recovery name"
    );
    assert_eq!(read.pruned, 1, "and is still counted as not read");
}

#[test]
fn a_broken_draft_survives_both_a_discard_and_a_save() {
    let mut ws = with_foreign_draft("{ rott");

    ws.discard_draft(&doc("nota.md")).expect("discard");
    assert_eq!(ws.read(&draft_file("nota.md")), "{ rott");

    ws.save_draft(&doc("nota.md"), "il buffer", None)
        .expect("draft saved");
    assert_eq!(ws.read(&draft_file("nota~recovery.md")), "{ rott");
    assert_eq!(ws.drafts().expect("drafts").drafts[0].text, "il buffer");
}

#[test]
fn a_draft_of_ours_is_still_discarded() {
    let mut ws = Bench::new().with_file("nota.md", "# Nota\n").mounts();
    ws.save_draft(&doc("nota.md"), "sporco", None)
        .expect("draft saved");

    ws.discard_draft(&doc("nota.md")).expect("discard");

    assert!(!ws.exists(&draft_file("nota.md")));
    let read = ws.drafts().expect("drafts");
    assert!(read.drafts.is_empty());
    assert_eq!(read.pruned, 0);
}
