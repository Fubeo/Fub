//! Il controllo (`fub_canvas_core::check`): i problemi della forma e della
//! compilazione con il loro codice, il riassunto di ciò che cambia, gli avvisi
//! sulle schede toccate, e il giro su tutti i vettori di `canvas-ops/`, dove
//! `check` dà `ok` se e solo se `compile` non dà errore.

use std::path::PathBuf;

use fub_canvas_core::check::{check, CheckReport, Code, WarningCode};
use fub_canvas_core::describe::{outline, DescribeOptions};
use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::patch::draft;
use fub_canvas_core::spec::example_canvas;
use fub_canvas_core::{parse, Canvas, CanvasNode, CanvasNodeType};
use serde_json::{json, Value};

/// La lavagna di prova: due schede di testo, una di file e un arco.
const BOARD: &str = r##"{
  "nodes": [
    {"id":"t1","type":"text","x":0,"y":0,"width":320,"height":160,"text":"Ciclo dell'acqua"},
    {"id":"t2","type":"text","x":400,"y":0,"width":320,"height":160,"text":"Evaporazione"},
    {"id":"f1","type":"file","file":"Scienze/nuvole.png","x":0,"y":240,"width":320,"height":200}
  ],
  "edges": [{"id":"e1","fromNode":"t1","toNode":"t2","label":"porta a"}]
}"##;

/// La lavagna con due schede che si coprono già, una di testo che non ci sta e
/// una lontana: per vedere che un avviso non riguarda le schede che nessuno tocca.
const CROWDED: &str = r##"{
  "nodes": [
    {"id":"t1","type":"text","x":0,"y":0,"width":320,"height":160,"text":"Ciclo dell'acqua"},
    {"id":"t2","type":"text","x":400,"y":0,"width":320,"height":160,"text":"Evaporazione"},
    {"id":"f1","type":"file","file":"Scienze/nuvole.png","x":0,"y":240,"width":320,"height":200},
    {"id":"t3","type":"text","x":100,"y":40,"width":200,"height":160,"text":"sopra"},
    {"id":"big","type":"text","x":800,"y":0,"width":320,"height":160,"text":"a\na\na\na\na\na\na\na\na\na"}
  ],
  "edges": []
}"##;

/// Dieci righe di una lettera: la stima vuole 272 di altezza.
const TEN_LINES: &str = "a\na\na\na\na\na\na\na\na\na";

fn board() -> Canvas {
    parse(BOARD).expect("la lavagna di prova si apre")
}

fn codes(report: &CheckReport) -> Vec<Code> {
    report.problems.iter().map(|problem| problem.code).collect()
}

fn warning_codes(report: &CheckReport) -> Vec<WarningCode> {
    report.warnings.iter().map(|warning| warning.code).collect()
}

fn text_card(id: &str, x: i64, y: i64, width: i64, height: i64, text: &str) -> Value {
    json!({"op": "add_card", "node": {"id": id, "type": "text", "x": x, "y": y, "width": width, "height": height, "text": text}})
}

// ---------------------------------------------------------------------------
// La forma
// ---------------------------------------------------------------------------

#[test]
fn la_lista_vuota_e_invalid_e_non_ha_lettura() {
    let report = check(&board(), &json!([]), 1);
    assert!(!report.ok);
    assert_eq!(codes(&report), vec![Code::Invalid]);
    assert_eq!(report.problems[0].index, None);
    assert_eq!(report.problems[0].path, "");
    assert!(report.summary.is_none(), "senza riassunto");
    assert!(report.outline_after.is_none(), "senza lettura di dopo");
    assert!(report.warnings.is_empty());
}

#[test]
fn una_lista_che_non_e_una_lista_e_wrong_type() {
    let report = check(&board(), &json!({"op": "move"}), 1);
    assert_eq!(codes(&report), vec![Code::WrongType]);
    assert_eq!(report.problems[0].index, None);
    assert!(!report.ok);
}

#[test]
fn il_nome_sbagliato_ha_il_vicino_e_la_correzione() {
    let report = check(
        &board(),
        &json!([{"op": "add-card", "node": {"type": "text", "x": 0, "y": 400, "width": 320, "height": 160, "text": ""}}]),
        1,
    );
    assert_eq!(codes(&report), vec![Code::UnknownOp]);
    let problem = &report.problems[0];
    assert_eq!(problem.path, "/0/op");
    assert_eq!(problem.suggestion.as_deref(), Some("add_card"));
    assert_eq!(
        problem.fix,
        Some(
            json!({"op": "add_card", "node": {"type": "text", "x": 0, "y": 400, "width": 320, "height": 160, "text": ""}})
        )
    );
}

#[test]
fn un_campo_di_troppo_e_unknown_field_e_uno_mancante_e_missing_field() {
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["t1"], "dx": 1, "dy": 0, "dz": 2}]),
        1,
    );
    assert_eq!(codes(&report), vec![Code::UnknownField]);
    assert_eq!(report.problems[0].path, "/0/dz");

    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["t1"], "dx": 1}]),
        1,
    );
    assert_eq!(codes(&report), vec![Code::MissingField]);
    assert_eq!(report.problems[0].path, "/0/dy");
    assert!(!report.ok);
}

#[test]
fn un_id_come_stringa_e_wrong_type_con_la_lista_come_correzione() {
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": "t1", "dx": 1, "dy": 0}]),
        1,
    );
    assert_eq!(codes(&report), vec![Code::WrongType]);
    let problem = &report.problems[0];
    assert_eq!(problem.path, "/0/ids");
    assert_eq!(
        problem.fix,
        Some(json!({"op": "move", "ids": ["t1"], "dx": 1, "dy": 0}))
    );
}

// ---------------------------------------------------------------------------
// La compilazione
// ---------------------------------------------------------------------------

#[test]
fn un_id_di_scheda_che_non_c_e_e_unknown_node_con_i_vicini() {
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["t9"], "dx": 40, "dy": 0}]),
        1,
    );
    assert_eq!(codes(&report), vec![Code::UnknownNode]);
    let problem = &report.problems[0];
    assert_eq!(problem.index, Some(0));
    assert_eq!(problem.path, "/0/ids/0", "il puntatore arriva all'id");
    assert_eq!(problem.suggestion.as_deref(), Some("t1, t2"));
    assert_eq!(problem.fix, None, "due vicini: nessuna correzione sicura");
    assert!(!problem.message.is_empty());
    assert!(report.summary.is_none() && report.outline_after.is_none());
}

#[test]
fn il_vicino_ignora_le_maiuscole_ascii() {
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["T1"], "dx": 1, "dy": 0}]),
        1,
    );
    assert_eq!(codes(&report), vec![Code::UnknownNode]);
    assert_eq!(report.problems[0].suggestion.as_deref(), Some("t1"));
}

#[test]
fn un_id_di_arco_che_non_c_e_e_unknown_edge_con_il_vicino() {
    let report = check(&board(), &json!([{"op": "remove", "ids": ["e9"]}]), 1);
    assert_eq!(codes(&report), vec![Code::UnknownEdge]);
    let problem = &report.problems[0];
    assert_eq!(problem.path, "/0/ids/0");
    assert_eq!(problem.suggestion.as_deref(), Some("e1"));
}

#[test]
fn un_id_gia_preso_e_duplicate_id_col_puntatore_all_id() {
    let report = check(&board(), &json!([text_card("t1", 0, 400, 320, 160, "")]), 1);
    assert_eq!(codes(&report), vec![Code::DuplicateId]);
    assert_eq!(report.problems[0].path, "/0/node/id");
    assert_eq!(report.problems[0].suggestion, None);
}

#[test]
fn una_scheda_che_il_formato_non_accetta_e_invalid() {
    let report = check(
        &board(),
        &json!([{"op": "resize", "id": "t1", "width": 0, "height": 10}]),
        1,
    );
    assert_eq!(codes(&report), vec![Code::Invalid]);
    let problem = &report.problems[0];
    assert_eq!(problem.index, Some(0));
    assert_eq!(problem.path, "/0");
    assert!(
        problem.message.contains("positive"),
        "il motivo: {}",
        problem.message
    );
}

#[test]
fn la_centomillesima_scheda_e_too_many() {
    let canvas = Canvas {
        nodes: (0..100_000)
            .map(|i| CanvasNode {
                id: format!("n{i}"),
                node_type: CanvasNodeType::Text,
                x: 0,
                y: 0,
                width: 10,
                height: 10,
                color: None,
                text: Some(String::new()),
                file: None,
                subpath: None,
                url: None,
                label: None,
                background: None,
                background_style: None,
                extra: serde_json::Map::new(),
            })
            .collect(),
        ..Canvas::default()
    };
    let report = check(&canvas, &json!([text_card("ultima", 0, 0, 10, 10, "")]), 1);
    assert_eq!(codes(&report), vec![Code::TooMany]);
    assert!(
        report.problems[0].message.contains("100000"),
        "{}",
        report.problems[0].message
    );
}

#[test]
fn la_compilazione_si_ferma_al_primo_problema() {
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["t9"], "dx": 0, "dy": 0}, {"op": "remove", "ids": ["e9"]}]),
        1,
    );
    assert_eq!(report.problems.len(), 1, "come `compile`: il primo");
    assert_eq!(report.problems[0].index, Some(0));
}

// ---------------------------------------------------------------------------
// Il riassunto
// ---------------------------------------------------------------------------

#[test]
fn una_scheda_nata_ha_id_e_testo_accorciato_come_nella_lettura() {
    let long = "a".repeat(100);
    let ops = json!([{"op": "add_card", "node": {"type": "text", "x": 0, "y": 400, "width": 320, "height": 160, "text": long}}]);
    let report = check(&board(), &ops, 7);
    assert!(report.ok, "{report:?}");
    let parsed: Vec<CanvasOp> = serde_json::from_value(ops).expect("le operazioni si leggono");
    let created = compile(&board(), &parsed, 7).expect("si compila").created;
    let summary = report.summary.as_ref().expect("un riassunto");
    assert_eq!(summary.cards_added.len(), 1);
    assert_eq!(
        summary.cards_added[0].id, created[0],
        "l'id è quello del seme"
    );
    let text = summary.cards_added[0].text.as_deref().expect("un testo");
    assert_eq!(
        text,
        format!("{}…", "a".repeat(59)),
        "sessanta caratteri, il … compreso"
    );
}

#[test]
fn spostare_e_ridimensionare_dicono_da_dove_a_dove() {
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["t1"], "dx": 8, "dy": 0}, {"op": "resize", "id": "f1", "width": 400, "height": 200}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    let summary = report.summary.as_ref().expect("un riassunto");
    let moved = summary
        .cards_changed
        .iter()
        .find(|card| card.id == "t1")
        .expect("t1");
    let moved_to = moved.moved.expect("t1 si è spostata");
    assert_eq!((moved_to.from.x, moved_to.from.y), (0, 0));
    assert_eq!((moved_to.to.x, moved_to.to.y), (8, 0));
    assert!(moved.resized.is_none() && moved.fields.is_empty());
    let resized = summary
        .cards_changed
        .iter()
        .find(|card| card.id == "f1")
        .expect("f1");
    let resized_to = resized.resized.expect("f1 si è ridimensionata");
    assert_eq!((resized_to.from.width, resized_to.from.height), (320, 200));
    assert_eq!((resized_to.to.width, resized_to.to.height), (400, 200));
    assert!(resized.moved.is_none());
}

#[test]
fn cambiare_i_campi_li_elenca_senza_la_posizione() {
    let report = check(
        &board(),
        &json!([{"op": "set", "id": "t1", "fields": {"color": "5", "text": "Nuovo"}}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    let summary = report.summary.as_ref().expect("un riassunto");
    let change = summary.cards_changed.first().expect("una scheda cambiata");
    let mut fields = change.fields.clone();
    fields.sort();
    assert_eq!(fields, vec!["color".to_owned(), "text".to_owned()]);
    assert_eq!(change.text.as_deref(), Some("Nuovo"), "il testo di dopo");
    assert!(change.moved.is_none() && change.resized.is_none());
}

#[test]
fn togliere_una_scheda_toglie_anche_i_suoi_archi() {
    let report = check(&board(), &json!([{"op": "remove", "ids": ["t1"]}]), 1);
    assert!(report.ok, "{report:?}");
    let summary = report.summary.as_ref().expect("un riassunto");
    assert_eq!(summary.cards_removed.len(), 1);
    assert_eq!(summary.cards_removed[0].id, "t1");
    assert_eq!(
        summary.cards_removed[0].text.as_deref(),
        Some("Ciclo dell'acqua"),
        "com'era"
    );
    assert_eq!(summary.edges_removed.len(), 1);
    assert_eq!(summary.edges_removed[0].id, "e1");
    assert_eq!(summary.edges_removed[0].from_node, "t1");
    assert_eq!(summary.edges_removed[0].to_node, "t2");
}

#[test]
fn un_arco_nuovo_si_dice_con_i_suoi_estremi() {
    let report = check(
        &board(),
        &json!([{"op": "connect", "edge": {"id": "e2", "fromNode": "t2", "toNode": "f1"}}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    let summary = report.summary.as_ref().expect("un riassunto");
    assert_eq!(summary.edges_added.len(), 1);
    assert_eq!(summary.edges_added[0].id, "e2");
    assert_eq!(summary.edges_added[0].from_node, "t2");
    assert_eq!(summary.edges_added[0].to_node, "f1");
    assert!(report
        .outline_after
        .as_deref()
        .is_some_and(|text| text.contains("e2 t2 -> f1")));
}

#[test]
fn il_reorder_dice_l_ordine_solo_se_cambia() {
    let report = check(&board(), &json!([{"op": "reorder", "ids": ["t1"]}]), 1);
    assert!(report.ok, "{report:?}");
    assert!(report
        .summary
        .as_ref()
        .is_some_and(|summary| summary.order_changed));

    // `f1` è già in cima: il giro non cambia nulla.
    let report = check(&board(), &json!([{"op": "reorder", "ids": ["f1"]}]), 1);
    assert!(report.ok, "{report:?}");
    assert!(report
        .summary
        .as_ref()
        .is_some_and(|summary| !summary.order_changed));
}

#[test]
fn una_scheda_nata_e_tolta_nello_stesso_giro_non_si_dice() {
    let report = check(
        &board(),
        &json!([text_card("x1", 0, 400, 320, 160, "tmp"), {"op": "remove", "ids": ["x1"]}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    let summary = report.summary.as_ref().expect("un riassunto");
    assert!(summary.cards_added.is_empty() && summary.cards_removed.is_empty());
    assert!(summary.cards_changed.is_empty() && !summary.order_changed);
}

#[test]
fn un_set_senza_cambiamenti_non_riassume_nulla() {
    let canvas = board();
    let report = check(
        &canvas,
        &json!([{"op": "set", "id": "t1", "fields": {"text": "Ciclo dell'acqua"}}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    let summary = report.summary.as_ref().expect("un riassunto");
    assert!(summary.cards_changed.is_empty() && summary.edges_changed.is_empty());
    let before = outline(&canvas, &DescribeOptions::default());
    assert_eq!(report.outline_after.as_deref(), Some(before.as_str()));
}

// ---------------------------------------------------------------------------
// Gli avvisi
// ---------------------------------------------------------------------------

#[test]
fn due_schede_che_si_coprono_danno_overlap() {
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["f1"], "dx": 0, "dy": -200}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    assert_eq!(warning_codes(&report), vec![WarningCode::Overlap]);
    assert_eq!(
        report.warnings[0].ids,
        vec!["t1".to_owned(), "f1".to_owned()]
    );
    assert_eq!(report.warnings[0].estimated_height, None);
}

#[test]
fn un_bordo_che_combacia_non_e_una_copertura() {
    // f1 sotto t1: il bordo a y 160 combacia, nessuna area in comune.
    let report = check(
        &board(),
        &json!([{"op": "move", "ids": ["f1"], "dx": 0, "dy": -80}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    assert!(report
        .warnings
        .iter()
        .all(|warning| warning.code != WarningCode::Overlap));
}

#[test]
fn una_scheda_a_cavallo_di_un_gruppo_da_half_in_group() {
    let source = r##"{"nodes":[
        {"id":"g1","type":"group","x":0,"y":0,"width":480,"height":320,"label":"Gruppo"},
        {"id":"t1","type":"text","x":16,"y":16,"width":320,"height":160,"text":"dentro"}
    ],"edges":[]}"##;
    let canvas = parse(source).expect("la lavagna si apre");
    // Il gruppo che si sposta lascia a metà la scheda che stava dentro.
    let report = check(
        &canvas,
        &json!([{"op": "move", "ids": ["g1"], "dx": 300, "dy": 0}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    assert_eq!(warning_codes(&report), vec![WarningCode::HalfInGroup]);
    assert_eq!(
        report.warnings[0].ids,
        vec!["t1".to_owned(), "g1".to_owned()]
    );

    // Una scheda tutta dentro il gruppo non avvisa.
    let report = check(
        &canvas,
        &json!([{"op": "move", "ids": ["t1"], "dx": 100, "dy": 0}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
}

#[test]
fn un_testo_piu_alto_della_scheda_da_text_overflow() {
    let report = check(
        &board(),
        &json!([text_card("n1", 800, 400, 320, 160, TEN_LINES)]),
        1,
    );
    assert!(report.ok, "{report:?}");
    assert_eq!(warning_codes(&report), vec![WarningCode::TextOverflow]);
    assert_eq!(report.warnings[0].ids, vec!["n1".to_owned()]);
    assert_eq!(
        report.warnings[0].estimated_height,
        Some(272),
        "dieci righe"
    );

    // L'altezza che la stima vuole esatta non avvisa.
    let report = check(
        &board(),
        &json!([text_card("n1", 800, 400, 320, 272, TEN_LINES)]),
        1,
    );
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
}

#[test]
fn una_coppia_che_nessuno_tocca_non_avvisa() {
    let crowded = parse(CROWDED).expect("la lavagna con gli avvisi già lì si apre");
    // Le schede che si coprono e il testo che non ci sta ci sono già: nessuna
    // delle due è toccata, e non si dice nulla.
    let report = check(
        &crowded,
        &json!([{"op": "set", "id": "t2", "fields": {"text": "Nuovo"}}]),
        1,
    );
    assert!(report.ok, "{report:?}");
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);

    // Toccata la scheda che si copre, l'avviso c'è: è la coppia a dirlo.
    let report = check(
        &crowded,
        &json!([{"op": "set", "id": "t1", "fields": {"text": "Nuovo"}}]),
        1,
    );
    assert_eq!(warning_codes(&report), vec![WarningCode::Overlap]);
    assert_eq!(
        report.warnings[0].ids,
        vec!["t1".to_owned(), "t3".to_owned()]
    );
}

#[test]
fn un_gruppo_grande_si_controlla_con_la_lista_delle_grandi() {
    let source = r##"{"nodes":[
        {"id":"g","type":"group","x":0,"y":0,"width":3000,"height":3000,"label":"Grande"},
        {"id":"c","type":"text","x":2900,"y":0,"width":320,"height":160,"text":"x"}
    ],"edges":[]}"##;
    let canvas = parse(source).expect("la lavagna si apre");
    // La scheda `c` è toccata: il gruppo grande sta nella lista delle grandi.
    let report = check(
        &canvas,
        &json!([{"op": "set", "id": "c", "fields": {"text": "y"}}]),
        1,
    );
    assert_eq!(warning_codes(&report), vec![WarningCode::HalfInGroup]);
    // Il gruppo grande è toccato: si confronta con tutte le schede.
    let report = check(
        &canvas,
        &json!([{"op": "move", "ids": ["g"], "dx": 1, "dy": 0}]),
        1,
    );
    assert_eq!(warning_codes(&report), vec![WarningCode::HalfInGroup]);
    assert_eq!(report.warnings[0].ids, vec!["c".to_owned(), "g".to_owned()]);
}

#[test]
fn duemila_schede_nuove_si_controllano_con_la_griglia() {
    let mut ops: Vec<Value> = (0..2000)
        .map(|i| {
            text_card(
                &format!("c{i}"),
                (i % 50) * 400,
                (i / 50) * 200,
                320,
                160,
                "",
            )
        })
        .collect();
    let report = check(&Canvas::default(), &Value::Array(ops.clone()), 1);
    assert!(report.ok, "{:?}", report.problems);
    assert!(
        report.warnings.is_empty(),
        "una griglia senza coperture: {:?}",
        report.warnings
    );
    assert_eq!(
        report
            .summary
            .as_ref()
            .map(|summary| summary.cards_added.len()),
        Some(2000)
    );

    // Una scheda nuova sopra la prima copre solo lei.
    ops.push(text_card("x", 8, 8, 320, 160, ""));
    let report = check(&Canvas::default(), &Value::Array(ops), 1);
    assert!(report.ok, "{:?}", report.problems);
    assert_eq!(report.warnings.len(), 1, "{:?}", report.warnings);
    assert_eq!(report.warnings[0].code, WarningCode::Overlap);
    assert_eq!(
        report.warnings[0].ids,
        vec!["c0".to_owned(), "x".to_owned()]
    );
}

// ---------------------------------------------------------------------------
// La pagina: l'esempio di «Il controllo»
// ---------------------------------------------------------------------------

#[test]
fn l_esempio_della_pagina_e_quello_che_dice_il_codice() {
    let canvas = example_canvas().expect("la lavagna d'esempio si apre");
    let report = check(
        &canvas,
        &json!([{"op": "move", "ids": ["f1"], "dx": 0, "dy": -200}]),
        1,
    );
    let value = serde_json::to_value(&report).expect("il rapporto si scrive");
    assert_eq!(
        value,
        json!({
            "ok": true,
            "problems": [],
            "warnings": [{"code": "overlap", "ids": ["t1", "f1"]}],
            "summary": {
                "cards_added": [],
                "cards_removed": [],
                "cards_changed": [{
                    "id": "f1",
                    "text": "schemi/acqua.png",
                    "moved": {"from": {"x": 0, "y": 240}, "to": {"x": 0, "y": 40}}
                }],
                "edges_added": [],
                "edges_removed": [],
                "edges_changed": [],
                "order_changed": false
            },
            "outline_after": "cards 3 edges 1 groups 0 bounds 0 0 720×240\n\
        1 t1 text \"Ciclo dell'acqua\" 0 0 320×160\n\
        2 t2 text \"Evaporazione\" 400 0 320×160\n\
        3 f1 image \"schemi/acqua.png\" 0 40 320×200\n\
        e1 t1 -> t2 \"porta a\""
        })
    );

    let report = check(
        &canvas,
        &json!([{"op": "move", "ids": ["t9"], "dx": 40, "dy": 0}]),
        1,
    );
    let value = serde_json::to_value(&report).expect("il rapporto si scrive");
    assert_eq!(value["ok"], json!(false));
    assert_eq!(value["summary"], Value::Null);
    assert_eq!(value["outline_after"], Value::Null);
    assert_eq!(
        value["problems"][0],
        json!({"code": "unknown_node", "index": 0, "path": "/0/ids/0", "message": "there is no node with this id", "suggestion": "t1, t2"})
    );
}

// ---------------------------------------------------------------------------
// I vettori: `check` concorda con `compile`
// ---------------------------------------------------------------------------

fn vectors() -> Vec<(String, Value)> {
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/canvas-ops");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&folder)
        .expect("la cartella dei vettori")
        .map(|entry| entry.expect("una voce della cartella").path())
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .expect("un nome")
                .to_string_lossy()
                .into_owned();
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (name, value)
        })
        .collect()
}

fn kind_code(kind: &str) -> Code {
    match kind {
        "UnknownNode" => Code::UnknownNode,
        "UnknownEdge" => Code::UnknownEdge,
        "DuplicateId" => Code::DuplicateId,
        "TooMany" => Code::TooMany,
        "Invalid" => Code::Invalid,
        other => panic!("un `kind` sconosciuto {other:?}"),
    }
}

#[test]
fn il_controllo_concorda_con_compile_su_ogni_vettore() {
    let vectors = vectors();
    assert!(vectors.len() >= 20, "i vettori di canvas-ops ci sono");
    for (name, vector) in &vectors {
        let before =
            parse(&serde_json::to_string(&vector["before"]).expect("la lavagna si scrive"))
                .unwrap_or_else(|e| panic!("{name}: {e}"));
        let raw = vector["ops"].clone();
        let seed = vector["seed"].as_u64().unwrap_or(0);
        let report = check(&before, &raw, seed);
        let outcome = vector["expect"]["outcome"].as_str().expect("un esito");
        match outcome {
            "applied" => {
                assert!(
                    report.ok,
                    "{name}: il controllo dice no: {:?}",
                    report.problems
                );
                let ops: Vec<CanvasOp> = serde_json::from_value(raw).expect("si leggono");
                let compiled = compile(&before, &ops, seed).expect("si compila");
                let after = draft(&before, &compiled.patches).expect("le toppe si applicano");
                assert_eq!(
                    report.outline_after.as_deref(),
                    Some(outline(&after, &DescribeOptions::default()).as_str()),
                    "{name}: la lettura di dopo"
                );
            }
            "rejected" => {
                assert!(
                    !report.ok,
                    "{name}: il controllo dice sì a un giro che non si compila"
                );
                assert_eq!(report.problems.len(), 1, "{name}: un problema, il primo");
                let error = &vector["expect"]["error"];
                assert_eq!(
                    report.problems[0].index,
                    error["index"].as_u64().map(|i| i as usize),
                    "{name}"
                );
                assert_eq!(
                    report.problems[0].code,
                    kind_code(error["kind"].as_str().unwrap_or("")),
                    "{name}"
                );
            }
            "malformed" => assert!(!report.ok, "{name}: una lista malformata non passa"),
            other => panic!("{name}: esito {other:?}"),
        }
    }
}
