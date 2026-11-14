//! Il commit di sole toppe `ink` su una parte sola della lavagna
//! ([`Core::local`]) contro quello di tutto il testo ([`Core::written`]):
//! stesso sorgente byte per byte, stesso tratto, stesso modello, stesso
//! errore, e l'indice sempre uguale a quello che darebbe una scansione nuova.
//! Poi il lavoro: un tratto non rilegge né riscandisce la lavagna intera.

use serde_json::{json, Value};

use super::*;
use crate::ink::InkStroke;
use crate::source::SourceIndex;

const BRUSH: &str = "pf1 size=3 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 \
                     taperEnd=0 capStart=1 capEnd=1 sim=0 pen=ballpoint";

/// Un generatore congruenziale: gli stessi casi a ogni giro, senza crate.
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
        usize::try_from(self.next()).expect("33 bit") % n.max(1)
    }
}

fn stroke_value(id: &str, layer: &LayerRef, shift: usize) -> Value {
    let anchor = match layer {
        LayerRef::Board => json!({"kind": "free"}),
        LayerRef::Node(_) => json!({"kind": "card", "width": 640, "height": 420}),
    };
    json!({
        "id": id,
        "tool": "pen",
        "at": "2026-11-02T09:20:31.250Z",
        "brush": BRUSH,
        "color": "#0072b2",
        "anchor": anchor,
        "ink": format!("1 s100 cxypt {},{},128,0 25,-3,2,8 25,-3,-2,8", 100 + shift, 200 + shift),
    })
}

fn stroke(id: &str, layer: &LayerRef, shift: usize) -> InkStroke {
    InkStroke::from_value(&stroke_value(id, layer, shift)).expect("un tratto")
}

/// I tratti del livello `layer` nel modello di `core`.
fn strokes(core: &Core, layer: &LayerRef) -> Vec<InkStroke> {
    let value = match layer {
        LayerRef::Board => core.canvas().extra.get(INK_KEY),
        LayerRef::Node(id) => core
            .canvas()
            .nodes
            .iter()
            .find(|node| node.id == *id)
            .and_then(|node| node.extra.get(INK_KEY)),
    };
    value
        .and_then(|value| crate::ink::InkLayer::from_value(value).ok())
        .map(|layer| layer.strokes)
        .unwrap_or_default()
}

/// Il modello `before` col cambio `changed` (come lo mette la tela): le
/// schede di un cambio intero si prendono da `canvas`, le altre si
/// ritoccano nella lista dei tratti. `None` per `Changed::Whole`.
fn applied(before: &Value, changed: &Changed, canvas: &Canvas) -> Option<Value> {
    let Changed::Ink { nodes, board } = changed else {
        return None;
    };
    let splice = |layer: &mut Value, change: &LayerChange, whole: Value| match change {
        LayerChange::Whole => *layer = whole,
        LayerChange::Strokes {
            start,
            remove,
            insert,
        } => {
            let strokes = layer["strokes"].as_array_mut().expect("strokes");
            strokes.splice(*start..start + remove, insert.iter().cloned());
        }
    };
    let mut model = before.clone();
    for (at, change) in nodes {
        let node = crate::source::node_value(&canvas.nodes[*at]).expect("si scrive");
        match change {
            LayerChange::Whole => model["nodes"][*at] = node,
            change => splice(&mut model["nodes"][*at][INK_KEY], change, Value::Null),
        }
    }
    if let Some(change) = board {
        let whole = canvas.extra[INK_KEY].clone();
        assert!(
            model.get(INK_KEY).is_some(),
            "il livello della radice c'era"
        );
        splice(&mut model[INK_KEY], change, whole);
    }
    Some(model)
}

/// Fa il commit con `core` e lo confronta con quello di tutto il testo su
/// una copia: stesso esito, stesso sorgente, stesso tratto, stesso modello
/// (anche nell'ordine delle chiavi), stessa anteprima; dopo, il modello è
/// quello del sorgente e l'indice quello di una scansione nuova. Dice se il
/// commit è stato di una parte sola.
fn check(core: &mut Core, patches: &[CanvasPatch]) -> bool {
    let oracle = core.clone();
    let whole = oracle.written(patches);
    let preview = core.preview(patches);
    let outcome = core.commit(patches);
    match (whole, outcome) {
        (Ok((source, canvas)), Ok(committed)) => {
            assert_eq!(committed.source, source, "il sorgente di dopo");
            assert_eq!(core.source(), source);
            assert_eq!(
                committed.edit,
                Edit::between(oracle.source(), &source),
                "il tratto minimo"
            );
            assert_eq!(core.canvas(), &canvas, "il modello di dopo");
            assert_eq!(preview.expect("l'anteprima"), source);
            assert_eq!(committed.inverse, patch::inverse(patches));
            assert_eq!(core.canvas(), &parse(core.source()).expect("si rilegge"));
            if let Some(index) = &core.index {
                assert_eq!(
                    Some(index),
                    SourceIndex::new(core.source()).as_ref(),
                    "l'indice al passo"
                );
            }
            // Il cambio detto, messo sul modello di prima, dà quello di dopo.
            let before = crate::source::canvas_value(oracle.canvas()).expect("si scrive");
            let after = crate::source::canvas_value(core.canvas()).expect("si scrive");
            if let Some(changed) = applied(&before, &committed.changed, core.canvas()) {
                assert_eq!(changed, after, "il cambio detto");
                assert_eq!(
                    changed.to_string(),
                    after.to_string(),
                    "l'ordine delle chiavi"
                );
            }
            matches!(committed.changed, Changed::Ink { .. })
        }
        (Err(expected), Err(got)) => {
            assert_eq!(got.reason(), expected.reason());
            assert_eq!(got.to_string(), expected.to_string());
            assert_eq!(
                preview.expect_err("l'anteprima sbaglia uguale").to_string(),
                expected.to_string()
            );
            assert_eq!(
                core.source(),
                oracle.source(),
                "un errore non cambia niente"
            );
            assert_eq!(core.canvas(), oracle.canvas());
            false
        }
        (whole, outcome) => panic!("esiti diversi: {whole:?} contro {outcome:?}"),
    }
}

/// Le lavagne dei casi: compatta, rientrata, CRLF con BOM, la radice con
/// l'inchiostro per primo, le chiavi del livello in un altro ordine con campi
/// sconosciuti, una chiave della radice scritta con un escape, caratteri di
/// quattro byte vicino ai livelli.
fn sources() -> Vec<String> {
    let card = |id: &str, ink: Option<Value>| {
        let mut node = json!({"id": id, "type": "text", "text": format!("scheda {id}"),
                              "x": 0, "y": 0, "width": 640, "height": 420});
        if let Some(ink) = ink {
            node[INK_KEY] = ink;
        }
        node
    };
    let layer = |prefix: &str, layer: &LayerRef, count: usize| {
        let strokes: Vec<Value> = (0..count)
            .map(|i| stroke_value(&format!("{prefix}-{i}"), layer, i))
            .collect();
        json!({"v": 1, "strokes": strokes})
    };
    let a = LayerRef::Node("a".into());
    let pretty = json!({
        "nodes": [card("a", Some(layer("a", &a, 3))), card("b", None), card("c", None)],
        "edges": [],
        "fub:ink": layer("free", &LayerRef::Board, 2),
    });
    let pretty = format!(
        "{}\n",
        serde_json::to_string_pretty(&pretty).expect("si scrive")
    );
    let crlf = format!("\u{feff}{}", pretty.replace('\n', "\r\n"));
    let compact = serde_json::to_string(&json!({
        "nodes": [card("a", None), card("b", Some(layer("b", &LayerRef::Node("b".into()), 1)))],
        "edges": [{"id": "e", "fromNode": "a", "toNode": "b"}],
    }))
    .expect("si scrive");
    let ink_first = format!(
        "{{\"fub:ink\" : {} ,\n \"nodes\":[{}], \"x-altro\": [1, 2.0]}}",
        serde_json::to_string(&layer("free", &LayerRef::Board, 1)).expect("si scrive"),
        serde_json::to_string(&card("a", Some(layer("a", &a, 1)))).expect("si scrive"),
    );
    let odd_layer = concat!(
        "{\"nodes\":[{\"id\":\"a\",\"type\":\"text\",\"text\":\"😀 a\",\"x\":0,\"y\":0,",
        "\"width\":640,\"height\":420,\"fub:ink\":{\"strokes\":[{\"ink\":\"1 s100 cxypt 1,2,3,0\",",
        "\"id\":\"a-0\",\"x-mio\":{\"k\":[1.0,true]},\"tool\":\"pen\",\"at\":\"2026-11-02T09:20:31.250Z\",",
        "\"brush\":\"pf1 size=3\",\"color\":\"#0072b2\",\"anchor\":{\"kind\":\"card\",\"width\":640,\"height\":420}}],",
        "\"v\":1.0,\"x-livello\":\"😀\"}},",
        "{\"id\":\"b\",\"type\":\"text\",\"text\":\"😀\",\"x\":0,\"y\":0,\"width\":640,\"height\":420}],",
        "\"edges\":[]}"
    )
    .to_owned();
    let escaped_key = concat!(
        "{\"nodes\":[{\"id\":\"a\",\"type\":\"text\",\"text\":\"t\",\"x\":0,\"y\":0,\"width\":9,\"height\":9}],",
        "\"fub\\u003aink\":{\"v\":1,\"strokes\":[]}}"
    )
    .to_owned();
    vec![pretty, crlf, compact, ink_first, odd_layer, escaped_key]
}

/// Una toppa a caso sui livelli di `core`: aggiunge, toglie o cambia un
/// tratto; ogni tanto con un'immagine di prima sbagliata o su una scheda che
/// non c'è.
fn next_patch(rng: &mut Lcg, core: &Core, fresh: &mut usize) -> CanvasPatch {
    let mut layers: Vec<LayerRef> = core
        .canvas()
        .nodes
        .iter()
        .map(|node| LayerRef::Node(node.id.clone()))
        .collect();
    layers.push(LayerRef::Board);
    if rng.below(40) == 0 {
        layers.push(LayerRef::Node("manca".into()));
    }
    let layer = layers[rng.below(layers.len())].clone();
    let current = strokes(core, &layer);
    *fresh += 1;
    let id = format!("n-{fresh}");
    match (rng.below(5), current.len()) {
        (0 | 1, len) | (_, len @ 0) => CanvasPatch::Ink {
            at: if rng.below(3) == 0 {
                rng.below(len + 1)
            } else {
                len
            },
            layer: layer.clone(),
            before: None,
            after: Some(stroke(&id, &layer, *fresh)),
        },
        (2, len) => {
            let at = rng.below(len);
            CanvasPatch::Ink {
                layer,
                at,
                before: Some(current[at].clone()),
                after: None,
            }
        }
        (3, len) => {
            let at = rng.below(len);
            let mut after = current[at].clone();
            after.color = Some(json!("#d55e00"));
            CanvasPatch::Ink {
                layer,
                at,
                before: Some(current[at].clone()),
                after: Some(after),
            }
        }
        (_, len) => {
            // Un'immagine di prima che non è quella del livello.
            let at = rng.below(len);
            CanvasPatch::Ink {
                layer: layer.clone(),
                at,
                before: Some(stroke("non-cè", &layer, 0)),
                after: None,
            }
        }
    }
}

#[test]
fn the_local_path_writes_what_the_whole_path_writes() {
    let mut rng = Lcg(0x5eed);
    let mut local = 0;
    let mut whole = 0;
    for source in sources() {
        let mut core = Core::open(source).expect("si apre");
        let mut fresh = 0;
        for round in 0..120 {
            // Una lista di una, due o tre toppe, anche su livelli diversi.
            let count = 1 + rng.below(3);
            let mut patches = Vec::with_capacity(count);
            let mut scratch = core.clone();
            for _ in 0..count {
                let patch = next_patch(&mut rng, &scratch, &mut fresh);
                // La toppa dopo si fa sul livello di dopo, se questa entra.
                if scratch.commit(std::slice::from_ref(&patch)).is_ok() {
                    patches.push(patch);
                } else if patches.is_empty() || rng.below(4) == 0 {
                    patches.push(patch);
                    break;
                }
            }
            if patches.is_empty() {
                continue;
            }
            if check(&mut core, &patches) {
                local += 1;
            } else {
                whole += 1;
            }
            // Ogni tanto il file cambia da fuori fra due tratti: si rilegge.
            if round % 37 == 36 {
                let text = core.source().to_owned();
                core.reset(text).expect("si riapre");
                assert!(core.index.is_none());
            }
        }
    }
    // I casi passano davvero da tutte e due le strade.
    assert!(local > 300, "commit di una parte sola: {local}");
    assert!(whole > 50, "commit di tutto il testo: {whole}");
}

#[test]
fn undo_and_redo_of_a_stroke_stay_local() {
    for source in sources() {
        let mut core = Core::open(source.clone()).expect("si apre");
        let Some(node) = core.canvas().nodes.first() else {
            continue;
        };
        let layer = LayerRef::Node(node.id.clone());
        let at = strokes(&core, &layer).len();
        let add = CanvasPatch::Ink {
            layer: layer.clone(),
            at,
            before: None,
            after: Some(stroke("nuovo", &layer, 7)),
        };
        assert!(check(&mut core, std::slice::from_ref(&add)));
        let written = core.source().to_owned();
        let undo = patch::inverse(std::slice::from_ref(&add));
        // Togliere l'unico tratto fa sparire la chiave della scheda: è
        // ancora la voce di una scheda sola.
        assert!(check(&mut core, &undo));
        assert_eq!(core.source(), source, "l'annulla torna al testo di prima");
        assert!(check(&mut core, std::slice::from_ref(&add)));
        assert_eq!(core.source(), written, "il rifai torna al testo del tratto");
    }
}

#[test]
fn a_board_layer_that_appears_or_disappears_takes_the_whole_path() {
    let source = r#"{"nodes":[],"edges":[]}"#;
    let mut core = Core::open(source).expect("si apre");
    let add = CanvasPatch::Ink {
        layer: LayerRef::Board,
        at: 0,
        before: None,
        after: Some(stroke("libero", &LayerRef::Board, 0)),
    };
    assert!(
        !check(&mut core, std::slice::from_ref(&add)),
        "la chiave nasce"
    );
    let second = CanvasPatch::Ink {
        layer: LayerRef::Board,
        at: 1,
        before: None,
        after: Some(stroke("libero-2", &LayerRef::Board, 1)),
    };
    assert!(
        check(&mut core, std::slice::from_ref(&second)),
        "la chiave c'è"
    );
    assert!(check(
        &mut core,
        &patch::inverse(std::slice::from_ref(&second))
    ));
    assert!(
        !check(&mut core, &patch::inverse(std::slice::from_ref(&add))),
        "la chiave sparisce"
    );
    assert_eq!(core.source(), source);
}

/// Una lavagna da 2000 schede di testo, una scheda con 500 tratti e 500
/// tratti liberi, rientrata come la scrive Fub.
fn big_board() -> String {
    let mut nodes: Vec<Value> = (0..2000)
        .map(|i| {
            json!({"id": format!("t{i}"), "type": "text", "text": format!("Scheda {i}: un testo corto"),
                   "x": (i % 50) * 300, "y": (i / 50) * 200, "width": 280, "height": 160})
        })
        .collect();
    let voti = LayerRef::Node("voti".into());
    let card: Vec<Value> = (0..500)
        .map(|i| stroke_value(&format!("v-{i}"), &voti, i))
        .collect();
    nodes.insert(
        1000,
        json!({"id": "voti", "type": "file", "file": "S8/voti.xlsx", "x": 0, "y": -500,
               "width": 640, "height": 420, "fub:ink": {"v": 1, "strokes": card}}),
    );
    let free: Vec<Value> = (0..500)
        .map(|i| stroke_value(&format!("l-{i}"), &LayerRef::Board, i))
        .collect();
    let canvas = json!({"nodes": nodes, "edges": [], "fub:ink": {"v": 1, "strokes": free}});
    format!(
        "{}\n",
        serde_json::to_string_pretty(&canvas).expect("si scrive")
    )
}

/// I byte letti dal lettore e dallo scanner di tutto il testo mentre gira
/// `run`.
fn work<T>(run: impl FnOnce() -> T) -> (T, usize, usize) {
    let parsed = crate::read::work::total();
    let scanned = crate::source::work::whole();
    let out = run();
    (
        out,
        crate::read::work::total() - parsed,
        crate::source::work::whole() - scanned,
    )
}

#[test]
fn a_stroke_does_not_read_the_whole_board() {
    let source = big_board();
    let mut core = Core::open(source.clone()).expect("si apre");
    let voti = LayerRef::Node("voti".into());
    let add = |core: &Core, layer: &LayerRef, id: &str| CanvasPatch::Ink {
        layer: layer.clone(),
        at: strokes(core, layer).len(),
        before: None,
        after: Some(stroke(id, layer, 3)),
    };
    // Un tratto: l'esito, i byte letti, quelli scanditi e quelli della parte
    // riscritta, dopo il commit; la rilettura è quella della parte, più
    // l'involucro (`{"nodes":[…]}` o `{"fub:ink":…}`).
    let stroke_on = |core: &mut Core, patches: &[CanvasPatch], layer: &LayerRef| {
        let (committed, parsed, scanned) = work(|| core.commit(patches));
        let committed = committed.expect("il tratto entra");
        let whole = core.source().len();
        assert!(
            parsed < whole / 2,
            "letti {parsed} byte su {whole}: la lavagna intera"
        );
        let index = core.index.as_ref().expect("l'indice resta");
        let (start, end) = match layer {
            LayerRef::Board => index.board_ink_span(),
            LayerRef::Node(_) => index.node_span(1000),
        }
        .expect("la parte c'è");
        assert!(
            parsed <= end - start + 16,
            "letti {parsed} byte, la parte ne ha {}",
            end - start
        );
        (committed, scanned)
    };

    // Il primo tratto dopo l'apertura: una scansione per l'indice, nessuna
    // lettura di tutto il testo; si rilegge solo la scheda che cambia.
    let patch = add(&core, &voti, "primo");
    let (committed, scanned) = stroke_on(&mut core, std::slice::from_ref(&patch), &voti);
    assert_eq!(scanned, source.len(), "una scansione, per l'indice");
    assert_eq!(
        committed.changed,
        Changed::Ink {
            nodes: vec![(
                1000,
                LayerChange::Strokes {
                    start: 500,
                    remove: 0,
                    insert: vec![core.canvas().nodes[1000].extra[INK_KEY]["strokes"][500].clone()],
                }
            )],
            board: None
        }
    );

    // Il secondo tratto e uno libero: niente scansione di tutto il testo.
    for (layer, id) in [(&voti, "secondo"), (&LayerRef::Board, "libero")] {
        let patch = add(&core, layer, id);
        let (_, scanned) = stroke_on(&mut core, std::slice::from_ref(&patch), layer);
        assert_eq!(scanned, 0, "{id}: nessuna scansione di tutto il testo");
    }

    // L'annulla e il rifai come commit delle toppe inverse: anche loro locali.
    let patch = add(&core, &voti, "terzo");
    let done = core.commit(std::slice::from_ref(&patch)).expect("entra");
    let (_, scanned) = stroke_on(&mut core, &done.inverse, &voti);
    assert_eq!(scanned, 0);
    let (_, scanned) = stroke_on(&mut core, std::slice::from_ref(&patch), &voti);
    assert_eq!(scanned, 0);

    // Il file cambiato da fuori fra due tratti si rilegge, come oggi; il
    // tratto dopo scandisce una volta e scrive giusto.
    let outside = core
        .source()
        .replace("Scheda 7: un testo corto", "Scheda 7: cambiata da fuori");
    core.reset(outside.clone()).expect("si riapre");
    let patch = add(&core, &voti, "dopo-fuori");
    let oracle = core.written(std::slice::from_ref(&patch)).expect("entra").0;
    let (committed, scanned) = stroke_on(&mut core, std::slice::from_ref(&patch), &voti);
    assert_eq!(committed.source, oracle);
    assert_eq!(scanned, outside.len(), "una scansione, per l'indice nuovo");
    assert!(core.source().contains("cambiata da fuori"));
}

#[test]
fn the_edit_of_one_splice_is_the_minimal_edit() {
    let mut rng = Lcg(42);
    let alphabet = ["{", "}", "a", "b", ",", "\"", "é", "😀", " "];
    // Fino a `most` caratteri a caso.
    let word = |rng: &mut Lcg, most: usize| -> String {
        let len = rng.below(most);
        (0..len)
            .map(|_| alphabet[rng.below(alphabet.len())])
            .collect()
    };
    for _ in 0..5000 {
        let head = word(&mut rng, 6);
        let tail = word(&mut rng, 6);
        let old = format!("{{{}}}", word(&mut rng, 8));
        let new = format!("{{{}}}", word(&mut rng, 8));
        let before = format!("{head}{old}{tail}");
        let after = format!("{head}{new}{tail}");
        let splice = Splice {
            start: head.len(),
            end: head.len() + old.len(),
            text: new,
        };
        assert_eq!(
            splice_edit(&before, &after, std::slice::from_ref(&splice)),
            Edit::between(&before, &after),
            "{before:?} → {after:?}"
        );
    }
}

#[test]
fn a_layer_change_is_the_splice_of_the_strokes_or_the_whole_layer() {
    let layer = |strokes: &[&str]| json!({"v": 1, "strokes": strokes.iter().map(|id| json!({"id": id})).collect::<Vec<_>>()});
    let splice = |start, remove, insert: &[&str]| LayerChange::Strokes {
        start,
        remove,
        insert: insert.iter().map(|id| json!({"id": id})).collect(),
    };
    let between = |before: &Value, after: &Value| LayerChange::between(Some(before), Some(after));
    assert_eq!(
        between(&layer(&["a", "c"]), &layer(&["a", "b", "c"])),
        splice(1, 0, &["b"])
    );
    assert_eq!(
        between(&layer(&["a", "b"]), &layer(&["a", "b", "c"])),
        splice(2, 0, &["c"])
    );
    assert_eq!(
        between(&layer(&["a", "b", "c"]), &layer(&["a", "c"])),
        splice(1, 1, &[])
    );
    assert_eq!(
        between(&layer(&["a", "b", "c"]), &layer(&["a", "x", "y", "c"])),
        splice(1, 1, &["x", "y"])
    );
    // Prefisso e suffisso non si sovrappongono: due uguali, uno via.
    assert_eq!(
        between(&layer(&["a", "a"]), &layer(&["a"])),
        splice(1, 1, &[])
    );
    assert_eq!(
        between(&layer(&["a"]), &layer(&["a", "a"])),
        splice(1, 0, &["a"])
    );
    assert_eq!(between(&layer(&["a"]), &layer(&["a"])), splice(1, 0, &[]));
    // Il livello che nasce o sparisce, un altro campo, un altro ordine: intero.
    assert_eq!(
        LayerChange::between(None, Some(&layer(&["a"]))),
        LayerChange::Whole
    );
    assert_eq!(
        LayerChange::between(Some(&layer(&["a"])), None),
        LayerChange::Whole
    );
    let mut other = layer(&["a", "b"]);
    other["v"] = json!(2);
    assert_eq!(between(&layer(&["a"]), &other), LayerChange::Whole);
    let turned = json!({"strokes": [{"id": "a"}, {"id": "b"}], "v": 1});
    assert_eq!(between(&layer(&["a"]), &turned), LayerChange::Whole);
    let extra = json!({"v": 1, "strokes": [{"id": "a"}], "x": 0});
    assert_eq!(between(&layer(&["a"]), &extra), LayerChange::Whole);
    assert_eq!(
        between(&json!({"v": 1, "strokes": 3}), &layer(&["a"])),
        LayerChange::Whole
    );
}
