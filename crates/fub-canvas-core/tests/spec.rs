//! Lo schema delle operazioni (`src/spec.rs`) contro serde, che legge
//! `CanvasOp`.
//!
//! `OPS` è la sola fonte di nomi, campi ed esempi. Questi test la confrontano
//! con serde: una variante senza voce, un campo obbligatorio che serde non
//! vuole, o un esempio che non si legge fanno fallire il test. `validate` ha
//! un problema se e solo se serde non legge la lista, sui vettori di
//! `canvas-ops/` e sul corpus `canvas-tasks/`. Il corpus viene dopo T3: finché
//! non c'è, il test lo dice e non controlla niente.

use std::collections::BTreeSet;
use std::path::PathBuf;

use fub_canvas_core::ops::{compile, CanvasOp};
use fub_canvas_core::spec::{
    example_canvas, json_schema, validate, FieldKind, Problem, ProblemCode, OPS,
};
use serde::Deserialize;
use serde_json::{json, Value};

/// Quante varianti deve avere almeno `CanvasOp`: il messaggio di serde che le
/// elenca deve restare leggibile.
const MIN_OPS: usize = 7;

/// I vettori di `canvas-ops/` sono venti o più: se si leggono meno, la
/// cartella è sbagliata e il test non deve passare a vuoto.
const MIN_VECTORS: usize = 20;

fn fixtures(folder: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__")
        .join(folder)
}

/// I nomi che serde dà per un'operazione che non esiste: il messaggio dice
/// «expected one of …».
fn serde_names() -> Vec<String> {
    let error = serde_json::from_str::<CanvasOp>(r#"{"op":"__nessuna__"}"#)
        .expect_err("un'operazione che non esiste non si legge");
    let text = error.to_string();
    let list = text
        .split_once("expected one of ")
        .map(|(_, rest)| rest)
        .unwrap_or_default();
    let list = list.split(" at line ").next().unwrap_or_default();
    list.split(", ")
        .map(|name| name.trim().trim_matches('`').to_owned())
        .filter(|name| !name.is_empty())
        .collect()
}

/// `validate` non trova problemi se e solo se serde legge la lista. La lista
/// vuota è l'unica eccezione: `validate` la dà `invalid`, e serde la legge. Per
/// questo non passa da qui: la prova è in `lista_vuota_e_invalid`.
fn assert_agrees(name: &str, list: &Value) {
    assert!(
        list.as_array().is_some_and(|items| !items.is_empty()),
        "{name}: la lista vuota non passa da qui"
    );
    let serde_reads = Vec::<CanvasOp>::deserialize(list).is_ok();
    let problems = validate(list);
    assert_eq!(
        problems.is_empty(),
        serde_reads,
        "{name}: validate dà {problems:?}, serde legge: {serde_reads}"
    );
}

/// I vettori di `folder`, in ordine di nome: `(file, json)`.
fn vectors(folder: &str) -> Vec<(String, Value)> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(fixtures(folder))
        .expect("la cartella dei vettori")
        .map(|entry| entry.expect("una voce della cartella").path())
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path
                .file_name()
                .expect("un nome di file")
                .to_string_lossy()
                .into_owned();
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
            let json = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
            (name, json)
        })
        .collect()
}

/// Un valore del tipo giusto per un campo obbligatorio.
fn sample(kind: FieldKind) -> Value {
    match kind {
        FieldKind::Id | FieldKind::Text => json!("a"),
        FieldKind::Ids => json!(["a"]),
        FieldKind::Number => json!(1),
        FieldKind::Bool => json!(true),
        FieldKind::Enum(values) => json!(values[0]),
        FieldKind::Node | FieldKind::Edge | FieldKind::Object => json!({}),
        FieldKind::Points => json!([[0, 1]]),
        FieldKind::Color => json!("red"),
        FieldKind::Sides => json!("auto"),
        FieldKind::Pair => json!([1, 2]),
        FieldKind::Any => Value::Null,
    }
}

/// Un valore di un tipo che il campo non accetta. `Any` accetta tutto.
fn wrong(kind: FieldKind) -> Option<Value> {
    match kind {
        FieldKind::Any => None,
        FieldKind::Id | FieldKind::Text | FieldKind::Enum(_) | FieldKind::Color => Some(json!(1)),
        FieldKind::Ids | FieldKind::Bool | FieldKind::Number | FieldKind::Points => {
            Some(json!("a"))
        }
        FieldKind::Node | FieldKind::Edge | FieldKind::Object | FieldKind::Sides => Some(json!(1)),
        FieldKind::Pair => Some(json!("a")),
    }
}

/// Un'operazione con tutti i campi obbligatori del tipo giusto.
fn minimal(spec: &fub_canvas_core::spec::OpSpec) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("op".to_owned(), json!(spec.name));
    for field in spec.fields.iter().filter(|field| field.required) {
        object.insert(field.name.to_owned(), sample(field.kind));
    }
    Value::Object(object)
}

fn has_problem(problems: &[Problem], code: ProblemCode, path: &str) -> bool {
    problems
        .iter()
        .any(|problem| problem.code == code && problem.path == path)
}

#[test]
fn ogni_variante_ha_la_sua_voce() {
    let from_serde: BTreeSet<String> = serde_names().into_iter().collect();
    let from_spec: BTreeSet<String> = OPS.iter().map(|op| op.name.to_owned()).collect();
    assert!(
        from_serde.len() >= MIN_OPS,
        "il messaggio di serde per un'operazione sconosciuta è cambiato: {from_serde:?}"
    );
    assert_eq!(
        from_spec, from_serde,
        "OPS e le varianti di CanvasOp non coincidono"
    );
    assert_eq!(from_spec.len(), OPS.len(), "un nome è ripetuto in OPS");
}

#[test]
fn ogni_voce_ha_esempi_che_serde_legge_con_il_suo_nome() {
    for op in OPS {
        assert!(!op.examples.is_empty(), "{}: nessun esempio", op.name);
        for text in op.examples {
            let value: Value = serde_json::from_str(text)
                .unwrap_or_else(|e| panic!("{}: un esempio non è JSON: {e}", op.name));
            let parsed = CanvasOp::deserialize(&value)
                .unwrap_or_else(|e| panic!("{}: serde non legge {text}: {e}", op.name));
            assert_eq!(parsed.name(), op.name, "name() diverge dalla voce");
            let back = serde_json::to_value(&parsed).expect("un'operazione si scrive");
            assert_eq!(back["op"], json!(op.name), "il tag di serde diverge");
            assert!(
                validate(&json!([value])).is_empty(),
                "{}: validate non accetta un esempio",
                op.name
            );
        }
    }
}

#[test]
fn gli_esempi_compilano_sulla_lavagna_d_esempio() {
    let canvas = example_canvas().expect("la lavagna d'esempio si legge");
    for op in OPS {
        for text in op.examples {
            let parsed: CanvasOp = serde_json::from_str(text).expect("un esempio si legge");
            compile(&canvas, &[parsed], 1)
                .unwrap_or_else(|e| panic!("{}: {text} non compila: {e}", op.name));
        }
    }
}

#[test]
fn i_campi_coincidono_con_serde() {
    for op in OPS {
        let whole = minimal(op);
        assert!(
            CanvasOp::deserialize(&whole).is_ok(),
            "{}: serde non legge l'operazione minima",
            op.name
        );
        assert!(validate(&json!([whole.clone()])).is_empty(), "{}", op.name);
        for field in op.fields {
            let path = format!("/0/{}", field.name);
            if field.required {
                let mut without = whole.clone();
                without
                    .as_object_mut()
                    .expect("un oggetto")
                    .remove(field.name);
                assert!(
                    CanvasOp::deserialize(&without).is_err(),
                    "{}: serde legge senza `{}`, obbligatorio nella voce",
                    op.name,
                    field.name
                );
                assert!(
                    has_problem(
                        &validate(&json!([without])),
                        ProblemCode::MissingField,
                        &path
                    ),
                    "{}: manca missing_field per `{}`",
                    op.name,
                    field.name
                );
            }
            if let Some(bad) = wrong(field.kind) {
                let mut changed = whole.clone();
                changed[field.name] = bad;
                assert!(
                    CanvasOp::deserialize(&changed).is_err(),
                    "{}: serde legge `{}` con un tipo sbagliato",
                    op.name,
                    field.name
                );
                assert!(
                    has_problem(&validate(&json!([changed])), ProblemCode::WrongType, &path),
                    "{}: manca wrong_type per `{}`",
                    op.name,
                    field.name
                );
            }
        }
    }
}

#[test]
fn lo_schema_ha_un_ramo_per_operazione() {
    let schema = json_schema();
    assert_eq!(
        schema["$schema"],
        json!("https://json-schema.org/draft/2020-12/schema")
    );
    assert_eq!(schema["type"], json!("array"));
    assert_eq!(schema["minItems"], json!(1));
    let branches = schema["items"]["oneOf"].as_array().expect("un oneOf");
    assert_eq!(branches.len(), OPS.len(), "un ramo per operazione");
    for (branch, op) in branches.iter().zip(OPS) {
        assert_eq!(branch["properties"]["op"]["const"], json!(op.name));
        assert_eq!(branch["additionalProperties"], json!(false), "{}", op.name);
        let properties: BTreeSet<&str> = branch["properties"]
            .as_object()
            .expect("le proprietà")
            .keys()
            .map(String::as_str)
            .collect();
        let declared: BTreeSet<&str> = std::iter::once("op")
            .chain(op.fields.iter().map(|field| field.name))
            .collect();
        assert_eq!(properties, declared, "{}: le proprietà", op.name);
        let required: BTreeSet<&str> = branch["required"]
            .as_array()
            .expect("un elenco")
            .iter()
            .filter_map(Value::as_str)
            .collect();
        let expected: BTreeSet<&str> = std::iter::once("op")
            .chain(op.fields.iter().filter(|f| f.required).map(|f| f.name))
            .collect();
        assert_eq!(required, expected, "{}: i campi obbligatori", op.name);
        assert_eq!(
            branch["examples"].as_array().map(Vec::len),
            Some(op.examples.len()),
            "{}: un esempio non passa nello schema",
            op.name
        );
    }
}

#[test]
fn le_liste_dei_vettori_si_leggono_come_serde() {
    let files = vectors("canvas-ops");
    assert!(
        files.len() >= MIN_VECTORS,
        "solo {} vettori di canvas-ops",
        files.len()
    );
    for (name, vector) in &files {
        let ops = vector
            .get("ops")
            .unwrap_or_else(|| panic!("{name}: manca ops"));
        assert_agrees(name, ops);
    }
}

#[test]
fn i_compiti_del_corpus_si_leggono_come_serde() {
    let folder = fixtures("canvas-tasks");
    if !folder.exists() {
        // Il corpus viene da T3: finché non c'è, questo test non controlla
        // niente, e lo dice.
        eprintln!("canvas-tasks/ non c'è in questo ramo: il corpus non si controlla");
        return;
    }
    for (name, task) in vectors("canvas-tasks") {
        for key in ["ops_today", "ops"] {
            if let Some(list) = task.get(key).filter(|value| value.is_array()) {
                assert_agrees(&format!("{name} {key}"), list);
            }
        }
    }
}

#[test]
fn la_lista_vuota_e_invalid() {
    let problems = validate(&json!([]));
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].code, ProblemCode::Invalid);
    assert_eq!(problems[0].index, None);
    assert_eq!(problems[0].path, "");
    // serde la legge: è la sola differenza, dichiarata in `validate`.
    assert!(Vec::<CanvasOp>::deserialize(&json!([])).is_ok());
}

#[test]
fn una_lista_che_non_e_una_lista_e_wrong_type() {
    for value in [json!({}), json!("move"), json!(null), json!(3)] {
        let problems = validate(&value);
        assert_eq!(problems.len(), 1, "{value}");
        assert_eq!(problems[0].code, ProblemCode::WrongType, "{value}");
        assert_eq!(problems[0].index, None);
        assert_eq!(problems[0].path, "");
    }
}

#[test]
fn un_comando_sbagliato_ha_il_nome_vicino_e_la_correzione() {
    let problems = validate(&json!([{"op": "add-card"}]));
    assert_eq!(problems.len(), 1, "{problems:?}");
    let problem = &problems[0];
    assert_eq!(problem.code, ProblemCode::UnknownOp);
    assert_eq!(problem.index, Some(0));
    assert_eq!(problem.path, "/0/op");
    assert_eq!(problem.suggestion.as_deref(), Some("add_card"));
    assert_eq!(problem.fix, Some(json!({"op": "add_card"})));
}

#[test]
fn un_op_mancante_o_non_testuale_non_ha_vicini() {
    let missing = validate(&json!([{"ids": ["a"]}]));
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].code, ProblemCode::UnknownOp);
    assert_eq!(missing[0].path, "/0/op");
    assert_eq!(missing[0].suggestion, None);
    assert_eq!(missing[0].fix, None);

    let number = validate(&json!([{"op": 5}]));
    assert_eq!(number.len(), 1);
    assert_eq!(number[0].code, ProblemCode::WrongType);
    assert_eq!(number[0].path, "/0/op");

    let not_an_object = validate(&json!([1]));
    assert_eq!(not_an_object.len(), 1);
    assert_eq!(not_an_object[0].code, ProblemCode::WrongType);
    assert_eq!(not_an_object[0].path, "/0");
}

#[test]
fn un_nome_molto_lungo_non_ha_vicini_e_non_costa_di_piu() {
    let long = "x".repeat(1_000_000);
    let problems = validate(&json!([{ "op": long }]));
    assert_eq!(problems.len(), 1);
    assert_eq!(problems[0].code, ProblemCode::UnknownOp);
    assert_eq!(problems[0].suggestion, None);
}

#[test]
fn ids_come_stringa_ha_la_lista_come_correzione() {
    let problems = validate(&json!([{"op": "remove", "ids": "t1"}]));
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].code, ProblemCode::WrongType);
    assert_eq!(problems[0].path, "/0/ids");
    assert_eq!(
        problems[0].fix,
        Some(json!({"op": "remove", "ids": ["t1"]}))
    );
}

#[test]
fn un_id_non_testuale_dentro_una_lista_ha_il_suo_posto() {
    let problems = validate(&json!([{"op": "remove", "ids": ["t1", 2]}]));
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].code, ProblemCode::WrongType);
    assert_eq!(problems[0].path, "/0/ids/1");
    assert_eq!(problems[0].fix, None);
}

#[test]
fn due_campi_sconosciuti_sono_due_problemi() {
    let problems = validate(&json!([
        {"op": "move", "ids": ["a"], "dx": 0, "dy": 0, "foo": 1, "bar": 2}
    ]));
    assert_eq!(problems.len(), 2, "{problems:?}");
    assert!(problems
        .iter()
        .all(|problem| problem.code == ProblemCode::UnknownField));
    assert!(has_problem(&problems, ProblemCode::UnknownField, "/0/foo"));
    assert!(has_problem(&problems, ProblemCode::UnknownField, "/0/bar"));
    assert!(problems.iter().all(|problem| problem.suggestion.is_none()));
}

#[test]
fn un_campo_vicino_ha_la_correzione_se_il_posto_e_libero() {
    // `dX` è un errore di battitura di `dx`, che però manca: due problemi.
    let problems = validate(&json!([{"op": "move", "ids": ["a"], "dX": 5, "dy": 0}]));
    assert_eq!(problems.len(), 2, "{problems:?}");
    assert!(has_problem(&problems, ProblemCode::MissingField, "/0/dx"));
    let typo = problems
        .iter()
        .find(|problem| problem.code == ProblemCode::UnknownField)
        .expect("il campo sconosciuto");
    assert_eq!(typo.path, "/0/dX");
    assert_eq!(typo.suggestion.as_deref(), Some("dx"));
    assert_eq!(
        typo.fix,
        Some(json!({"op": "move", "ids": ["a"], "dx": 5, "dy": 0}))
    );

    // Con `dx` già presente la correzione non sarebbe una sola: niente fix.
    let taken = validate(&json!([{"op": "move", "ids": ["a"], "dX": 5, "dx": 0, "dy": 0}]));
    assert_eq!(taken.len(), 1, "{taken:?}");
    assert_eq!(taken[0].suggestion.as_deref(), Some("dx"));
    assert_eq!(taken[0].fix, None);
}

#[test]
fn un_campo_con_due_nomi_vicini_non_ha_correzione() {
    // `d` è a distanza 1 da `dx` e da `dy`: due nomi, nessuna correzione sola.
    let problems = validate(&json!([{"op": "move", "ids": ["a"], "dx": 0, "dy": 0, "d": 1}]));
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].suggestion.as_deref(), Some("dx, dy"));
    assert_eq!(problems[0].fix, None);
}

#[test]
fn un_campo_mancante_non_ha_correzione() {
    let problems = validate(&json!([{"op": "move"}]));
    assert_eq!(problems.len(), 3, "{problems:?}");
    for path in ["/0/ids", "/0/dx", "/0/dy"] {
        assert!(
            has_problem(&problems, ProblemCode::MissingField, path),
            "{path}"
        );
    }
    assert!(problems.iter().all(|problem| problem.fix.is_none()));
}

#[test]
fn un_intero_scritto_con_zeri_passa_e_una_frazione_no() {
    let whole = validate(&json!([{"op": "move", "ids": ["a"], "dx": 1.0, "dy": 1e2}]));
    assert!(whole.is_empty(), "{whole:?}");
    let fraction = validate(&json!([{"op": "move", "ids": ["a"], "dx": 1.5, "dy": 0}]));
    assert_eq!(fraction.len(), 1, "{fraction:?}");
    assert_eq!(fraction[0].code, ProblemCode::WrongType);
    assert_eq!(fraction[0].path, "/0/dx");
}

#[test]
fn un_numero_non_finito_non_entra_in_un_valore() {
    // Il JSON non ha `NaN` né `Infinity`, e serde_json rifiuta un numero fuori
    // scala: il valore non arriva a `validate`.
    assert!(serde_json::from_str::<Value>("[1e400]").is_err());
    // Un `NaN` costruito in Rust diventa `null`, e `null` è un tipo sbagliato.
    let problems = validate(&json!([{"op": "move", "ids": ["a"], "dx": f64::NAN, "dy": 0}]));
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].code, ProblemCode::WrongType);
    assert_eq!(problems[0].path, "/0/dx");
}

#[test]
fn una_chiave_con_barra_si_scrive_come_puntatore_json() {
    let problems = validate(&json!([{"op": "move", "ids": ["a"], "d/x": 1, "dx": 0, "dy": 0}]));
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].path, "/0/d~1x");
    assert_eq!(problems[0].suggestion.as_deref(), Some("dx"));
}

#[test]
fn centomila_operazioni_restano_lineari() {
    let good = json!({"op": "move", "ids": ["a"], "dx": 1, "dy": 1});
    let mut list: Vec<Value> = std::iter::repeat_n(good, 100_000).collect();
    assert!(validate(&Value::Array(list.clone())).is_empty());
    list[99_999] = json!({"op": "move", "ids": "a", "dx": 1, "dy": 1});
    let problems = validate(&Value::Array(list));
    assert_eq!(problems.len(), 1, "{problems:?}");
    assert_eq!(problems[0].index, Some(99_999));
    assert_eq!(problems[0].code, ProblemCode::WrongType);
}

#[test]
fn il_problema_si_scrive_come_il_contratto() {
    let problems = validate(&json!([{"op": "move", "ids": ["a"], "dX": 1, "dx": 0, "dy": 0}]));
    let written = serde_json::to_value(&problems[0]).expect("un problema si scrive");
    assert_eq!(written["code"], json!("unknown_field"));
    assert_eq!(written["index"], json!(0));
    assert_eq!(written["path"], json!("/0/dX"));
    assert_eq!(written["message"], json!("the operation has no such field"));
    assert_eq!(written["suggestion"], json!("dx"));
    assert!(
        written.get("fix").is_none(),
        "senza una correzione sola, niente fix"
    );

    let unknown = validate(&json!([{"op": "remove", "ids": ["a"], "zz": 1}]));
    let written = serde_json::to_value(&unknown[0]).expect("un problema si scrive");
    assert!(
        written.get("suggestion").is_none(),
        "un campo senza vicini non ha suggerimento"
    );

    let list = validate(&json!({}));
    let written = serde_json::to_value(&list[0]).expect("un problema si scrive");
    assert!(written["index"].is_null(), "la lista intera non ha indice");
}
