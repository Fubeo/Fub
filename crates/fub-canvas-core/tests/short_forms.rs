//! La forma breve di `add_card` e `connect` (`ops/card.rs`, `ops/connect.rs`):
//! i casi che i vettori di `canvas-ops/` non dicono da soli.
//!
//! I vettori danno l'esito di una lista. Qui si prova il perché: il limite del
//! testo, il posto accanto a una scheda con una misura scritta a mano, la
//! correzione che la forma dà a un nome sbagliato, un `null` che vale come
//! assente per tutti e due i lettori, e il giro di `code` con i suoi ripieghi.

use fub_canvas_core::describe::{code, DescribeOptions};
use fub_canvas_core::model::MAX_TEXT_BYTES;
use fub_canvas_core::ops::{compile, CanvasOp, OpError};
use fub_canvas_core::patch::draft;
use fub_canvas_core::spec::{validate, ProblemCode};
use fub_canvas_core::{parse, Canvas, CanvasNode};
use serde_json::{json, Value};

fn board(source: &str) -> Canvas {
    parse(source).expect("una lavagna che si apre")
}

fn ops(value: Value) -> Vec<CanvasOp> {
    serde_json::from_value(value).expect("le operazioni si leggono")
}

fn card<'a>(canvas: &'a Canvas, id: &str) -> &'a CanvasNode {
    canvas
        .nodes
        .iter()
        .find(|node| node.id == id)
        .expect("la scheda c'è")
}

/// Un testo di esattamente il limite del modello entra; un byte in più no.
#[test]
fn un_testo_di_un_mebibyte_entra_e_un_byte_in_piu_no() {
    let empty = Canvas::default();
    let fits = "x".repeat(MAX_TEXT_BYTES);
    let compiled = compile(
        &empty,
        &ops(json!([{"op": "add_card", "id": "t", "text": fits}])),
        1,
    )
    .expect("un mebibyte esatto entra");
    let after = draft(&empty, &compiled.patches).expect("le toppe si applicano");
    assert_eq!(
        card(&after, "t").text.as_ref().map(String::len),
        Some(MAX_TEXT_BYTES)
    );

    let too_big = "x".repeat(MAX_TEXT_BYTES + 1);
    let error = compile(
        &empty,
        &ops(json!([{"op": "add_card", "id": "t", "text": too_big}])),
        1,
    )
    .expect_err("un byte in più non entra");
    assert!(
        matches!(error, OpError::Invalid { index: 0, .. }),
        "{error:?}"
    );
}

/// Con una misura scritta a mano, la scheda a sinistra o sopra tocca `near`
/// ancora a `gap`: il bordo che guarda `near` non si sposta.
#[test]
fn una_misura_a_mano_accanto_a_near_tiene_il_bordo_che_tocca_near() {
    let anchored = board(
        r#"{"nodes":[{"id":"a","type":"text","x":100,"y":100,"width":400,"height":160,"text":"a"}]}"#,
    );

    // A sinistra, 200 di larghezza: il bordo destro sta a 48 da «a», cioè su 52.
    let left = compile(
        &anchored,
        &ops(json!([{"op": "add_card", "id": "b", "text": "b", "near": "a", "side": "left", "width": 200}])),
        1,
    )
    .expect("si compila");
    let after = draft(&anchored, &left.patches).expect("si applica");
    let b = card(&after, "b");
    assert_eq!((b.x, b.width), (-148, 200));
    assert_eq!(b.x + b.width, 100 - 48);

    // Sopra, 80 di altezza: il bordo basso sta a 24 da «a», cioè su 76.
    let top = compile(
        &anchored,
        &ops(json!([{"op": "add_card", "id": "b", "text": "b", "near": "a", "side": "top", "height": 80}])),
        1,
    )
    .expect("si compila");
    let after = draft(&anchored, &top.patches).expect("si applica");
    let b = card(&after, "b");
    assert_eq!((b.y, b.height), (-4, 80));
    assert_eq!(b.y + b.height, 100 - 24);
}

/// Un nome sbagliato dà il suo errore con la correzione intera, quando è una
/// sola: come gli altri campi con un vocabolario.
#[test]
fn un_nome_sbagliato_ha_la_correzione_intera() {
    let side = validate(&json!([{"op": "add_card", "text": "a", "side": "rigth"}]));
    assert_eq!(side.len(), 1, "{side:?}");
    assert_eq!(side[0].code, ProblemCode::BadValue);
    assert_eq!(side[0].path, "/0/side");
    assert_eq!(side[0].suggestion.as_deref(), Some("right"));
    assert_eq!(
        side[0].fix,
        Some(json!({"op": "add_card", "text": "a", "side": "right"}))
    );

    let color = validate(&json!([{"op": "connect", "from": "a", "to": "b", "color": "gren"}]));
    assert_eq!(color.len(), 1, "{color:?}");
    assert_eq!(color[0].code, ProblemCode::BadValue);
    assert_eq!(color[0].path, "/0/color");
    assert_eq!(color[0].suggestion.as_deref(), Some("green"));
    assert_eq!(
        color[0].fix,
        Some(json!({"op": "connect", "from": "a", "to": "b", "color": "green"}))
    );

    let key =
        validate(&json!([{"op": "connect", "from": "a", "to": "b", "sides": {"frm": "right"}}]));
    assert_eq!(key.len(), 1, "{key:?}");
    assert_eq!(key[0].code, ProblemCode::UnknownField);
    assert_eq!(key[0].path, "/0/sides/frm");
    assert_eq!(key[0].suggestion.as_deref(), Some("from"));
    assert_eq!(
        key[0].fix,
        Some(json!({"op": "connect", "from": "a", "to": "b", "sides": {"from": "right"}}))
    );
}

/// Un `null` facoltativo vale come campo assente, per la forma e per serde: la
/// scheda nasce come se mancasse.
#[test]
fn un_null_facoltativo_e_un_campo_assente() {
    let value = json!([{
        "op": "add_card", "text": "a", "near": null, "side": null, "x": null, "y": null,
        "color": null, "content_size": null
    }]);
    assert!(validate(&value).is_empty(), "la forma accetta i null");
    let empty = Canvas::default();
    let compiled = compile(&empty, &ops(value), 1).expect("la lista si compila");
    let after = draft(&empty, &compiled.patches).expect("si applica");
    let node = after.nodes.first().expect("una scheda");
    assert_eq!((node.x, node.y, node.width, node.height), (0, 0, 320, 160));
    assert_eq!(node.color, None);
}

/// `code` scrive la forma breve dove ci sta, e ripiega sulla forma intera o
/// sull'arco del file dove non ci sta. Compilato su una lavagna vuota, ridà la
/// stessa lavagna.
#[test]
fn code_usa_la_forma_breve_e_ricompila_la_stessa_lavagna() {
    let source = board(
        r##"{
          "nodes": [
            {"id":"t1","type":"text","x":0,"y":0,"width":320,"height":160,"text":"Ciclo","color":"1"},
            {"id":"t2","type":"text","x":400,"y":0,"width":480,"height":160,"text":"Una riga lunga abbastanza da allargare la scheda oltre le trentasei lettere"},
            {"id":"f1","type":"file","x":0,"y":200,"width":480,"height":360,"file":"Foto/gita.jpg"},
            {"id":"p1","type":"file","x":520,"y":200,"width":360,"height":512,"file":"Corsi/dispensa.pdf","subpath":"#page=5"},
            {"id":"l1","type":"link","x":0,"y":600,"width":320,"height":120,"url":"https://example.org/a","color":"#ff8800"},
            {"id":"g1","type":"group","x":-40,"y":-40,"width":1000,"height":900,"label":"Temi"},
            {"id":"x1","type":"text","x":900,"y":0,"width":320,"height":160,"text":"con un campo ignoto","xVendor":true}
          ],
          "edges": [
            {"id":"e1","fromNode":"t1","toNode":"t2","fromSide":"right","toSide":"left","toEnd":"arrow","label":"porta a"},
            {"id":"e2","fromNode":"t2","toNode":"l1","fromEnd":"arrow","toEnd":"none"},
            {"id":"e3","fromNode":"f1","toNode":"x1"},
            {"id":"e4","fromNode":"f1","toNode":"f1","fromEnd":"arrow","toEnd":"arrow","color":"6"}
          ]
        }"##,
    );

    let listed = code(&source, &DescribeOptions::default());
    let values: Vec<Value> = listed
        .iter()
        .map(|op| serde_json::to_value(op).expect("un'operazione si scrive"))
        .collect();
    let whole_cards = values
        .iter()
        .filter(|value| value.get("node").is_some())
        .count();
    let whole_edges = values
        .iter()
        .filter(|value| value.get("edge").is_some())
        .count();
    // Solo la scheda con un campo ignoto va intera; solo l'arco senza `toEnd`
    // e quello con la punta di partenza senza quella di arrivo vanno interi.
    assert_eq!((whole_cards, whole_edges), (1, 2), "{values:#?}");
    assert_eq!(values[0]["id"], json!("t1"));
    assert_eq!(values[0]["color"], json!("red"));
    assert!(
        values[0].get("width").is_none(),
        "una misura di nascita non si scrive"
    );

    let empty = Canvas::default();
    let compiled = compile(&empty, &listed, 1).expect("il codice si compila");
    let again = draft(&empty, &compiled.patches).expect("si applica");
    assert_eq!(
        serde_json::to_value(&again.nodes).expect("le schede si scrivono"),
        serde_json::to_value(&source.nodes).expect("le schede si scrivono"),
    );
    assert_eq!(
        serde_json::to_value(&again.edges).expect("gli archi si scrivono"),
        serde_json::to_value(&source.edges).expect("gli archi si scrivono"),
    );
}
