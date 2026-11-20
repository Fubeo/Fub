//! La lavagna aperta (`commit::Core`): un commit per ogni variante di
//! `CommitError` lascia la lavagna com'era, il tratto minimo ricompone il
//! sorgente nuovo senza tagliare un carattere, `reset` riapre. I byte dei
//! commit riusciti li fissano i vettori di `patch_vectors.rs`.

use fub_canvas_core::commit::{CommitError, Core, Edit};
use fub_canvas_core::model::MAX_SOURCE_BYTES;
use fub_canvas_core::patch::{upsert_node_patch, CanvasPatch, PatchError};
use fub_canvas_core::{CanvasColor, CanvasError, CanvasNode, PresetColor};

const ONE: &str = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"uno"}],"edges":[]}"#;

fn node(core: &Core, id: &str) -> CanvasNode {
    core.canvas()
        .nodes
        .iter()
        .find(|node| node.id == id)
        .cloned()
        .expect("la scheda c'è")
}

fn moved(core: &Core, x: i64) -> CanvasPatch {
    let mut after = node(core, "a");
    after.x = x;
    upsert_node_patch(core.canvas(), &after).expect("la scheda cambia")
}

/// La lavagna dopo un errore è quella di prima, sorgente e modello.
fn unchanged(core: &Core, source: &str) {
    assert_eq!(core.source(), source);
    assert_eq!(core.canvas(), Core::open(source).expect("si apre").canvas());
}

#[test]
fn a_commit_replaces_source_and_model() {
    let mut core = Core::open(ONE).unwrap();
    let patch = moved(&core, 10);
    let committed = core.commit(&[patch]).unwrap();
    assert_eq!(committed.source, ONE.replace(r#""x":0"#, r#""x":10"#));
    assert_eq!(core.source(), committed.source);
    assert_eq!(node(&core, "a").x, 10);
    assert_eq!(
        committed.edit,
        Edit {
            start: ONE.find(r#""x":0"#).unwrap() + 4,
            end: ONE.find(r#""x":0"#).unwrap() + 4,
            text: "1".into(),
        },
        "il tratto minimo: si aggiunge solo l'1 davanti allo 0"
    );
    let undone = core.commit(&committed.inverse).unwrap();
    assert_eq!(undone.source, ONE);
}

#[test]
fn an_empty_commit_changes_nothing() {
    let mut core = Core::open(ONE).unwrap();
    let committed = core.commit(&[]).unwrap();
    assert_eq!(committed.source, ONE);
    assert!(committed.inverse.is_empty());
    assert_eq!(committed.edit.text, "");
    assert_eq!(committed.edit.start, committed.edit.end);
    unchanged(&core, ONE);
}

#[test]
fn stale_leaves_the_core_as_it_was() {
    let mut core = Core::open(ONE).unwrap();
    let mut patch = moved(&core, 10);
    if let CanvasPatch::UpsertNode {
        before: Some(before),
        ..
    } = &mut patch
    {
        before.x = 5;
    }
    let error = core.commit(&[moved(&core, 20), patch]).unwrap_err();
    assert!(matches!(
        error,
        CommitError::Stale(PatchError::Stale { index: 1, .. })
    ));
    assert_eq!(error.reason(), "stale");
    unchanged(&core, ONE);
}

#[test]
fn invalid_leaves_the_core_as_it_was() {
    let mut core = Core::open(ONE).unwrap();
    let mut after = node(&core, "a");
    after.width = 0;
    let patch = upsert_node_patch(core.canvas(), &after).unwrap();
    let error = core.commit(&[patch]).unwrap_err();
    assert!(matches!(
        error,
        CommitError::Invalid(CanvasError::Invalid(_))
    ));
    assert_eq!(error.reason(), "invalid");
    unchanged(&core, ONE);
}

#[test]
fn rejected_leaves_the_core_as_it_was() {
    let source = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"uno"}],"edges":[],"k":1,"k":2}"#;
    let mut core = Core::open(source).unwrap();
    let patch = moved(&core, 10);
    let error = core.commit(&[patch]).unwrap_err();
    assert!(matches!(error, CommitError::Rejected(_)));
    assert_eq!(error.reason(), "rejected");
    unchanged(&core, source);
}

#[test]
fn unstable_leaves_the_core_as_it_was() {
    // Un testo di dopo oltre il limite non si rilegge: il sorgente di prima
    // ci sta per pochi byte, la scheda nuova lo porta fuori.
    let head = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"uno"}],"edges":[],"pad":""#;
    let tail = "\"}";
    let pad = MAX_SOURCE_BYTES - head.len() - tail.len() - 10;
    let source = format!("{head}{}{tail}", "p".repeat(pad));
    let mut core = Core::open(source.clone()).unwrap();
    let mut after = node(&core, "a");
    after.id = "b".into();
    let patch = upsert_node_patch(core.canvas(), &after).unwrap();
    let error = core.commit(&[patch]).unwrap_err();
    assert!(matches!(
        error,
        CommitError::Unstable {
            reread: Some(CanvasError::Limit { .. })
        }
    ));
    assert_eq!(error.reason(), "unstable");
    assert_eq!(core.source(), source);
    assert_eq!(core.canvas().nodes.len(), 1);
}

#[test]
fn reset_reopens_and_an_unreadable_source_keeps_the_core() {
    let mut core = Core::open(ONE).unwrap();
    assert!(core.reset("{").is_err());
    unchanged(&core, ONE);
    core.reset("").unwrap();
    assert_eq!(core.source(), "");
    assert!(core.canvas().nodes.is_empty());
}

/// `prima[..start] + text + prima[end..]` è il sorgente nuovo, anche con
/// caratteri di quattro byte accanto al cambiamento: il tratto non taglia
/// mai un carattere.
#[test]
fn the_edit_never_cuts_a_character() {
    let cases = [
        ("😀a😀", "😀b😀"),
        // Lo stesso primo byte (F0 9F 98) in due emoji diverse.
        ("x😀y", "x😃y"),
        ("😀", "😃"),
        ("a😀", "a😀😀"),
        ("😀😀", "😀"),
        ("", "😀"),
        ("😀", ""),
        ("é", "è"),
        ("ab", "ab"),
    ];
    for (before, after) in cases {
        let edit = Edit::between(before, after);
        assert!(
            before.is_char_boundary(edit.start),
            "{before:?} → {after:?}"
        );
        assert!(before.is_char_boundary(edit.end), "{before:?} → {after:?}");
        assert!(edit.start <= edit.end);
        assert_eq!(
            edit.apply(before).as_deref(),
            Some(after),
            "{before:?} → {after:?}: {edit:?}"
        );
    }
    let edit = Edit::between("x😀y", "x😃y");
    assert_eq!((edit.start, edit.end, edit.text.as_str()), (1, 5, "😃"));
}

#[test]
fn the_edit_of_a_commit_next_to_wide_characters() {
    let source = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"😀a😀"}],"edges":[]}"#;
    let mut core = Core::open(source).unwrap();
    let mut after = node(&core, "a");
    after.text = Some("😀b😀".into());
    let patch = upsert_node_patch(core.canvas(), &after).unwrap();
    let committed = core.commit(&[patch]).unwrap();
    let edit = &committed.edit;
    assert_eq!(edit.text, "b");
    assert_eq!(&source[edit.start..edit.end], "a");
    assert_eq!(
        format!(
            "{}{}{}",
            &source[..edit.start],
            edit.text,
            &source[edit.end..]
        ),
        committed.source
    );
}

/// La scheda `a` di `ROSSO` ha un colore che Fub non conosce; `b` non ne ha.
const ROSSO: &str = r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"color":"rosso","text":"uno"},{"id":"b","type":"text","x":200,"y":0,"width":100,"height":50,"text":"due"}],"edges":[]}"#;

fn recoloured(core: &Core, id: &str, color: Option<CanvasColor>) -> CanvasPatch {
    let mut after = node(core, id);
    after.color = color;
    upsert_node_patch(core.canvas(), &after).expect("il colore cambia")
}

#[test]
fn t47b_a_card_with_an_unknown_colour_moves_and_keeps_the_colour_as_it_was() {
    let mut core = Core::open(ROSSO).unwrap();
    let committed = core.commit(&[moved(&core, 10)]).unwrap();
    assert_eq!(committed.source, ROSSO.replace(r#""x":0"#, r#""x":10"#));
    assert_eq!(core.commit(&[]).unwrap().source, committed.source);
}

#[test]
fn t47b_an_undo_brings_the_unknown_colour_back_byte_for_byte() {
    let mut core = Core::open(ROSSO).unwrap();
    let committed = core
        .commit(&[recoloured(
            &core,
            "a",
            Some(CanvasColor::Preset(PresetColor::Red)),
        )])
        .unwrap();
    assert!(committed.source.contains(r#""color":"1""#));
    let undone = core.commit(&committed.inverse).unwrap();
    assert_eq!(undone.source, ROSSO);
}

#[test]
fn t47b_a_copied_card_takes_an_unknown_colour_the_board_read() {
    let mut core = Core::open(ROSSO).unwrap();
    let mut copy = node(&core, "a");
    copy.id = "c".into();
    copy.x = 400;
    let patch = upsert_node_patch(core.canvas(), &copy).expect("la copia è nuova");
    let committed = core.commit(&[patch]).unwrap();
    assert_eq!(committed.source.matches(r#""color":"rosso""#).count(), 2);
}

#[test]
fn t47b_an_unknown_colour_the_board_never_read_is_still_invalid() {
    let mut core = Core::open(ONE).unwrap();
    for text in ["rosso", "#12", "7", ""] {
        let patch = recoloured(&core, "a", Some(CanvasColor::Unknown(text.into())));
        let error = core.commit(&[patch]).unwrap_err();
        assert_eq!(error.reason(), "invalid", "{text:?}");
        unchanged(&core, ONE);
    }
}

#[test]
fn t47b_a_reset_keeps_the_colours_read_before() {
    let mut core = Core::open(ROSSO).unwrap();
    let committed = core
        .commit(&[recoloured(
            &core,
            "a",
            Some(CanvasColor::Preset(PresetColor::Red)),
        )])
        .unwrap();
    core.reset(committed.source.as_str()).unwrap();
    assert_eq!(core.commit(&committed.inverse).unwrap().source, ROSSO);
    // Una lavagna aperta dal file di adesso non ha più «rosso» da riscrivere.
    let mut fresh = Core::open(committed.source.as_str()).unwrap();
    let error = fresh.commit(&committed.inverse).unwrap_err();
    assert_eq!(error.reason(), "invalid");
}
