//! Le toppe `ink` in serie: [`draft`] legge e riscrive il livello una volta
//! per ogni serie di toppe vicine sullo stesso livello, ma il risultato deve
//! essere quello di una toppa alla volta, che rilegge e riscrive il livello
//! ogni volta. Qui l'applicazione di una toppa alla volta com'era prima
//! della serie è tenuta come riferimento ([`one_by_one`]), e serie a caso
//! (inserimenti, sostituzioni, rimozioni, su più livelli alternati, con
//! schede cambiate in mezzo e un errore a metà) devono dare lo stesso
//! modello, byte per byte, o lo stesso errore con lo stesso `index`.
//!
//! In fondo una guardia di tempo larga: duemila tratti spostati, cancellati
//! e rimessi non fermano la lavagna (prima ci volevano secondi anche in
//! release, adesso millisecondi).

use std::time::{Duration, Instant};

use fub_canvas_core::commit::Core;
use fub_canvas_core::ink::{InkLayer, InkStroke, LayerRef, INK_KEY};
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::patch::{
    draft, same_stroke, upsert_node_patch, CanvasPatch, PatchError, Subject,
};
use fub_canvas_core::{parse, Canvas};
use serde_json::{json, Map, Value};

// ---------------------------------------------------------------------------
// Il riferimento: una toppa alla volta, come prima della serie.
// ---------------------------------------------------------------------------

/// `draft` di prima: ogni toppa `ink` rilegge il livello dal JSON e lo
/// riscrive; le altre passano da `draft` una alla volta, con l'`index`
/// rimesso al loro posto nella lista.
fn one_by_one(canvas: &Canvas, patches: &[CanvasPatch]) -> Result<Canvas, PatchError> {
    let mut current = canvas.clone();
    for (index, patch) in patches.iter().enumerate() {
        match patch {
            CanvasPatch::Ink {
                layer,
                at,
                before,
                after,
            } => old_ink_step(
                &mut current,
                index,
                layer,
                *at,
                before.as_ref(),
                after.as_ref(),
            )?,
            _ => {
                current = draft(&current, std::slice::from_ref(patch))
                    .map_err(|error| reindexed(error, index))?;
            }
        }
    }
    Ok(current)
}

/// L'errore di una lista di una toppa sola, con la posizione `index`.
fn reindexed(error: PatchError, at_index: usize) -> PatchError {
    let mut error = error;
    match &mut error {
        PatchError::Stale { index, .. }
        | PatchError::AtOutOfRange { index, .. }
        | PatchError::NodeHasEdges { index, .. }
        | PatchError::MissingEndpoint { index, .. }
        | PatchError::NotAPermutation { index }
        | PatchError::InkAtOutOfRange { index, .. }
        | PatchError::ForeignLayer { index, .. }
        | PatchError::DuplicateStroke { index, .. }
        | PatchError::EmptyInk { index } => *index = at_index,
    }
    error
}

fn old_holder<'a>(canvas: &'a mut Canvas, layer: &LayerRef) -> Option<&'a mut Map<String, Value>> {
    match layer {
        LayerRef::Board => Some(&mut canvas.extra),
        LayerRef::Node(id) => canvas
            .nodes
            .iter_mut()
            .find(|node| node.id == *id)
            .map(|node| &mut node.extra),
    }
}

/// `ink_step` com'era prima della serie, copiato qui.
fn old_ink_step(
    draft: &mut Canvas,
    index: usize,
    layer: &LayerRef,
    at: usize,
    before: Option<&InkStroke>,
    after: Option<&InkStroke>,
) -> Result<(), PatchError> {
    if before.is_none() && after.is_none() {
        return Err(PatchError::EmptyInk { index });
    }
    let Some(fields) = old_holder(draft, layer) else {
        let id = match layer {
            LayerRef::Node(id) => id.clone(),
            LayerRef::Board => String::new(),
        };
        return Err(PatchError::Stale {
            index,
            subject: Subject::Node(id),
        });
    };
    let mut ink = match fields.get(INK_KEY) {
        None => InkLayer::default(),
        Some(value) => InkLayer::from_value(value).map_err(|reason| PatchError::ForeignLayer {
            index,
            layer: layer.clone(),
            reason,
        })?,
    };
    let len = ink.strokes.len();
    match before {
        None if at > len => {
            return Err(PatchError::InkAtOutOfRange {
                index,
                layer: layer.clone(),
                at,
                len,
            })
        }
        Some(before)
            if !ink
                .strokes
                .get(at)
                .is_some_and(|current| same_stroke(current, before)) =>
        {
            return Err(PatchError::Stale {
                index,
                subject: Subject::Stroke {
                    layer: layer.clone(),
                    id: before.id.clone(),
                },
            });
        }
        None | Some(_) => {}
    }
    if let Some(after) = after {
        let replaced = before.map(|_| at);
        let taken = ink
            .strokes
            .iter()
            .enumerate()
            .any(|(position, stroke)| Some(position) != replaced && stroke.id == after.id);
        if taken {
            return Err(PatchError::DuplicateStroke {
                index,
                layer: layer.clone(),
                id: after.id.clone(),
            });
        }
    }
    match (before, after) {
        (None, Some(after)) => ink.strokes.insert(at, after.clone()),
        (Some(_), Some(after)) => ink.strokes[at] = after.clone(),
        (Some(_), None) => {
            ink.strokes.remove(at);
        }
        (None, None) => return Err(PatchError::EmptyInk { index }),
    }
    if ink.is_bare() {
        fields.shift_remove(INK_KEY);
    } else {
        fields.insert(INK_KEY.to_owned(), ink.to_value());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Le serie a caso.
// ---------------------------------------------------------------------------

/// Un generatore congruenziale con un seme fisso: le serie sono sempre le
/// stesse.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn below(&mut self, n: usize) -> usize {
        usize::try_from(self.next()).expect("31 bit") % n.max(1)
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
}

/// La lavagna di partenza: un livello della radice scritto con `v: 1.0` e
/// una chiave dopo di lui, una scheda con un livello che ha un campo
/// sconosciuto (non resta mai nudo), una scheda con il livello prima di
/// un'altra chiave (quando resta nudo e rinasce va in fondo), una scheda
/// senza livello e una con un livello estraneo.
fn base() -> Canvas {
    let free = |id: &str| stroke_value(id, LayerKind::Free, 0);
    let card = |id: &str| stroke_value(id, LayerKind::Card, 0);
    parse(
        &json!({
            "nodes": [
                {"id": "a", "type": "text", "x": 0, "y": 0, "width": 300, "height": 200,
                 "text": "a", "fub:ink": {"v": 1, "strokes": [card("a0"), card("a1")], "xNote": "resta"}},
                {"id": "b", "type": "text", "x": 400, "y": 0, "width": 300, "height": 200,
                 "text": "b", "fub:ink": {"v": 1, "strokes": [card("b0")]}, "zeta": [1, 2]},
                {"id": "c", "type": "text", "x": 800, "y": 0, "width": 300, "height": 200,
                 "text": "c"},
                {"id": "f", "type": "text", "x": 1200, "y": 0, "width": 300, "height": 200,
                 "text": "f", "fub:ink": {"v": 2, "strokes": []}}
            ],
            "edges": [],
            "fub:ink": {"v": 1.0, "strokes": [free("r0"), free("r1"), free("r2")]},
            "zz": true
        })
        .to_string(),
    )
    .expect("la lavagna di prova si legge")
}

#[derive(Clone, Copy)]
enum LayerKind {
    Free,
    Card,
}

fn stroke_value(id: &str, kind: LayerKind, shift: usize) -> Value {
    let anchor = match kind {
        LayerKind::Free => json!({"kind": "free"}),
        LayerKind::Card => json!({"kind": "card", "width": 300, "height": 200}),
    };
    json!({
        "id": id,
        "tool": "pen",
        "brush": "pf1 size=2 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint",
        "color": "#000000",
        "anchor": anchor,
        "ink": format!("1 s100 cxy {},{} 400,400", 100 + shift, 200 + shift),
    })
}

fn kind_of(layer: &LayerRef) -> LayerKind {
    match layer {
        LayerRef::Board => LayerKind::Free,
        LayerRef::Node(_) => LayerKind::Card,
    }
}

/// I tratti del livello `layer` di `canvas`, o niente se il livello è
/// estraneo o chi lo tiene non c'è.
fn strokes_of(canvas: &Canvas, layer: &LayerRef) -> Vec<InkStroke> {
    let fields = match layer {
        LayerRef::Board => Some(&canvas.extra),
        LayerRef::Node(id) => canvas
            .nodes
            .iter()
            .find(|node| node.id == *id)
            .map(|node| &node.extra),
    };
    fields
        .and_then(|fields| fields.get(INK_KEY))
        .map_or(Some(Vec::new()), |value| {
            InkLayer::from_value(value).ok().map(|ink| ink.strokes)
        })
        .unwrap_or_default()
}

fn new_stroke(rng: &mut Lcg, layer: &LayerRef, fresh: &mut usize) -> InkStroke {
    *fresh += 1;
    let id = format!("n{fresh}");
    InkStroke::from_value(&stroke_value(&id, kind_of(layer), rng.below(50))).expect("un tratto")
}

/// Una toppa sul modello `canvas`: quasi sempre giusta, a volte sbagliata
/// (immagine vecchia, `at` oltre la fine, id doppio, toppa vuota, livello
/// estraneo, scheda che non c'è).
fn next_patch(rng: &mut Lcg, canvas: &Canvas, fresh: &mut usize, wrong: bool) -> CanvasPatch {
    // Due livelli quasi sempre, alternati a caso, e ogni tanto gli altri.
    let layer = match rng.below(20) {
        0..=8 => LayerRef::Board,
        9..=14 => LayerRef::Node("b".to_owned()),
        15..=16 => LayerRef::Node("a".to_owned()),
        17 => LayerRef::Node("c".to_owned()),
        18 if wrong => LayerRef::Node("f".to_owned()),
        18 => LayerRef::Board,
        _ if wrong => LayerRef::Node("manca".to_owned()),
        _ => LayerRef::Node("b".to_owned()),
    };
    let strokes = strokes_of(canvas, &layer);
    let len = strokes.len();
    let pick = |rng: &mut Lcg| rng.below(len);
    let ink = |at, before: Option<InkStroke>, after: Option<InkStroke>| CanvasPatch::Ink {
        layer: layer.clone(),
        at,
        before,
        after,
    };
    if wrong {
        return match rng.below(5) {
            0 => ink(len + 1, None, Some(new_stroke(rng, &layer, fresh))),
            1 if len > 0 => {
                // L'immagine di prima di un altro posto, o cambiata.
                let at = pick(rng);
                let mut before = strokes[at].clone();
                before.color = Some(json!("#ff0000"));
                ink(at, Some(before), None)
            }
            2 if len > 0 => {
                let mut after = new_stroke(rng, &layer, fresh);
                after.id = strokes[pick(rng)].id.clone();
                ink(rng.below(len + 1), None, Some(after))
            }
            3 if len > 1 => {
                // Una sostituzione che prende l'id di un altro tratto.
                let at = pick(rng);
                let other = (at + 1) % len;
                let mut after = strokes[at].clone();
                after.id = strokes[other].id.clone();
                ink(at, Some(strokes[at].clone()), Some(after))
            }
            _ => ink(rng.below(len + 1), None, None),
        };
    }
    match rng.below(10) {
        // Ogni tanto una scheda cambia in mezzo: la serie si spezza.
        0 => {
            let mut node = canvas.nodes[rng.below(3)].clone();
            node.x += 1;
            upsert_node_patch(canvas, &node).expect("la scheda cambia")
        }
        1..=4 => ink(
            rng.below(len + 1),
            None,
            Some(new_stroke(rng, &layer, fresh)),
        ),
        5..=7 if len > 0 => {
            let at = pick(rng);
            let mut after = strokes[at].clone();
            if rng.chance(20) {
                // Il tratto cambia anche id, con uno nuovo.
                *fresh += 1;
                after.id = format!("n{fresh}");
            }
            after.ink = Some(json!(format!(
                "1 s100 cxy {},{} 400,400",
                rng.below(900),
                7
            )));
            ink(at, Some(strokes[at].clone()), Some(after))
        }
        _ if len > 0 => {
            let at = pick(rng);
            ink(at, Some(strokes[at].clone()), None)
        }
        _ => ink(0, None, Some(new_stroke(rng, &layer, fresh))),
    }
}

/// Il modello come testo JSON, con le chiavi nel loro ordine.
fn text(canvas: &Canvas) -> String {
    serde_json::to_string(canvas).expect("si scrive")
}

#[test]
fn a_series_gives_the_same_result_as_one_patch_at_a_time() {
    let mut rng = Lcg(0x1a20_2026_1111);
    let mut fresh = 0;
    let (mut applied, mut rejected, mut bare) = (0, 0, 0);
    for _ in 0..600 {
        let start = base();
        let mut current = start.clone();
        let mut patches = Vec::new();
        let length = 1 + rng.below(40);
        // L'errore, se c'è, a metà: dopo di lui altre toppe giuste.
        let wrong_at = rng.chance(50).then(|| rng.below(length));
        for position in 0..length {
            let wrong = wrong_at == Some(position);
            let patch = next_patch(&mut rng, &current, &mut fresh, wrong);
            if let Ok(next) = one_by_one(&current, std::slice::from_ref(&patch)) {
                current = next;
            }
            patches.push(patch);
        }
        let expected = one_by_one(&start, &patches);
        let actual = draft(&start, &patches);
        match (&expected, &actual) {
            (Ok(expected), Ok(actual)) => {
                assert_eq!(text(actual), text(expected), "toppe: {patches:?}");
                applied += 1;
                if !expected.nodes[1].extra.contains_key(INK_KEY) {
                    bare += 1;
                }
            }
            (Err(expected), Err(actual)) => {
                assert_eq!(actual, expected, "toppe: {patches:?}");
                rejected += 1;
            }
            _ => panic!("esiti diversi: {expected:?} contro {actual:?}\ntoppe: {patches:?}"),
        }
    }
    // Le serie provano tutti e due gli esiti e il livello che resta nudo.
    assert!(
        applied > 100 && rejected > 100,
        "{applied} applicate, {rejected} rifiutate"
    );
    assert!(bare > 0, "nessun livello della scheda b è rimasto nudo");
}

#[test]
fn a_layer_left_bare_in_the_middle_of_a_series_comes_back_at_the_end_of_the_fields() {
    let start = base();
    let layer = LayerRef::Node("b".to_owned());
    let b0 = strokes_of(&start, &layer)[0].clone();
    let again = InkStroke::from_value(&stroke_value("b9", LayerKind::Card, 3)).expect("un tratto");
    let patches = [
        CanvasPatch::Ink {
            layer: layer.clone(),
            at: 0,
            before: Some(b0),
            after: None,
        },
        CanvasPatch::Ink {
            layer: layer.clone(),
            at: 0,
            before: None,
            after: Some(again),
        },
    ];
    let actual = draft(&start, &patches).expect("si applica");
    assert_eq!(
        text(&actual),
        text(&one_by_one(&start, &patches).expect("si applica"))
    );
    let keys: Vec<&str> = actual.nodes[1].extra.keys().map(String::as_str).collect();
    assert_eq!(keys, ["zeta", INK_KEY]);
}

#[test]
fn a_board_layer_written_1_0_is_rewritten_1_when_it_empties_and_refills() {
    let start = base();
    let mut patches: Vec<CanvasPatch> = strokes_of(&start, &LayerRef::Board)
        .into_iter()
        .map(|stroke| CanvasPatch::Ink {
            layer: LayerRef::Board,
            at: 0,
            before: Some(stroke),
            after: None,
        })
        .collect();
    patches.push(CanvasPatch::Ink {
        layer: LayerRef::Board,
        at: 0,
        before: None,
        after: Some(
            InkStroke::from_value(&stroke_value("r9", LayerKind::Free, 0)).expect("tratto"),
        ),
    });
    let actual = draft(&start, &patches).expect("si applica");
    assert_eq!(
        text(&actual),
        text(&one_by_one(&start, &patches).expect("si applica"))
    );
    assert_eq!(actual.extra[INK_KEY]["v"], json!(1));
    let keys: Vec<&str> = actual.extra.keys().map(String::as_str).collect();
    assert_eq!(keys, ["zz", INK_KEY]);
}

#[test]
fn a_stroke_with_an_empty_id_makes_the_next_patch_find_a_foreign_layer() {
    // Il JSON non legge un tratto con l'id vuoto; chi costruisce le toppe in
    // Rust sì. La toppa dopo, come prima, trova il livello estraneo.
    let start = base();
    let mut empty = InkStroke::from_value(&stroke_value("x", LayerKind::Free, 0)).expect("tratto");
    empty.id = String::new();
    let next = InkStroke::from_value(&stroke_value("y", LayerKind::Free, 0)).expect("tratto");
    let patches = [
        CanvasPatch::Ink {
            layer: LayerRef::Board,
            at: 0,
            before: None,
            after: Some(empty),
        },
        CanvasPatch::Ink {
            layer: LayerRef::Board,
            at: 0,
            before: None,
            after: Some(next),
        },
    ];
    let expected = one_by_one(&start, &patches).expect_err("il livello è estraneo");
    assert!(matches!(
        expected,
        PatchError::ForeignLayer { index: 1, .. }
    ));
    assert_eq!(
        draft(&start, &patches).expect_err("lo stesso errore"),
        expected
    );
    // Da sola, la prima toppa si applica come prima.
    assert_eq!(
        text(&draft(&start, &patches[..1]).expect("si applica")),
        text(&one_by_one(&start, &patches[..1]).expect("si applica"))
    );
}

// ---------------------------------------------------------------------------
// La guardia di tempo.
// ---------------------------------------------------------------------------

/// Una lavagna con `count` tratti liberi sulla radice, come la scrive Fub.
fn board_with(count: usize) -> String {
    let strokes: Vec<Value> = (0..count)
        .map(|i| stroke_value(&format!("s{i}"), LayerKind::Free, i % 500))
        .collect();
    let mut text = serde_json::to_string_pretty(&json!({
        "nodes": [], "edges": [], "fub:ink": {"v": 1, "strokes": strokes}
    }))
    .expect("si scrive");
    text.push('\n');
    text
}

#[test]
fn two_thousand_strokes_move_erase_and_undo_without_stopping_the_board() {
    // Prima di applicare le toppe in serie ognuna rileggeva e riscriveva
    // tutto il livello: con duemila tratti circa 4 s per passo anche in
    // release. Adesso sono millisecondi; il tetto è largo apposta, anche per
    // la build di debug su una macchina carica.
    const CEILING: Duration = Duration::from_secs(10);
    let ids: Vec<String> = (0..2000).map(|i| format!("s{i}")).collect();
    let ops = [
        CanvasOp::MoveStrokes {
            layer: LayerRef::Board,
            ids: ids.clone(),
            dx: 3.0,
            dy: 2.0,
            to: None,
        },
        CanvasOp::EraseStrokes {
            layer: LayerRef::Board,
            ids,
        },
    ];
    let started = Instant::now();
    for op in ops {
        let source = board_with(2000);
        let mut core = Core::open(source.clone()).expect("la lavagna si apre");
        let compiled = compile(core.canvas(), &[op], 0).expect("si compila");
        assert_eq!(compiled.patches.len(), 2000);
        let done = core.commit(&compiled.patches).expect("si scrive");
        core.commit(&done.inverse).expect("si annulla");
        let original = parse(&source).expect("si legge");
        assert!(
            text(core.canvas()) == text(&original),
            "l'annulla ridà i tratti di prima"
        );
    }
    let elapsed = started.elapsed();
    assert!(elapsed < CEILING, "duemila tratti: {elapsed:?}");
}
