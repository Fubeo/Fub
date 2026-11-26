use super::*;
const SOURCE: &str = "properties:\n  - {key: status}\nviews:\n  - name: Board\n    type: kanban\n    order: [status]\n    group: {key: status}\n    sort: [{key: score, descending: true}]\n    summaries: [{key: score, aggregate: sum}]\n";

#[test]
fn ogni_chiave_dei_comandi_e_nelle_due_lingue() {
    let catalogs = catalog();
    assert_eq!(catalogs.len(), 2);
    for catalog in &catalogs {
        for (key, _, _) in STRINGS {
            assert!(
                catalog.entries.contains_key(*key),
                "«{key}» manca in «{}»",
                catalog.locale
            );
        }
        for spec in BaseCommands.commands() {
            let mut keys = vec![format!("{}.title", spec.id), format!("{}.desc", spec.id)];
            for param in &spec.params {
                keys.push(format!("{}.{}.title", spec.id, param.name));
                keys.push(format!("{}.{}.desc", spec.id, param.name));
            }
            for key in keys {
                assert!(
                    catalog.entries.contains_key(&key),
                    "«{key}» manca in «{}»",
                    catalog.locale
                );
            }
        }
    }
}

#[test]
fn sort_keys_order_like_the_values() {
    let values = [
        BaseValue::Empty,
        BaseValue::Number(2.5),
        BaseValue::Number(-1.0),
        BaseValue::Number(f64::NAN),
        BaseValue::Text("b".into()),
        BaseValue::Text("ab".into()),
        BaseValue::Text(String::new()),
        BaseValue::Bool(true),
        BaseValue::Bool(false),
        BaseValue::Date(20),
        BaseValue::Date(3),
        BaseValue::Duration(100),
        BaseValue::List(vec![BaseValue::Number(1.0), BaseValue::Text("x".into())]),
        BaseValue::List(Vec::new()),
        BaseValue::Object(BTreeMap::from([("k".into(), BaseValue::Bool(true))])),
        BaseValue::File {
            path: "b.md".into(),
            label: None,
        },
        BaseValue::Link {
            target: "a.md".into(),
            label: Some("z".into()),
        },
        BaseValue::Error(FormulaErrorCode::DivZero),
        BaseValue::Error(FormulaErrorCode::Name),
    ];
    for left in &values {
        for right in &values {
            let keys = SortKey::of(left.clone()).cmp(&SortKey::of(right.clone()));
            assert_eq!(keys, compare(left, right), "{left:?} ~ {right:?}");
        }
    }
}

#[test]
fn plan_includes_hidden_sort_and_summary_dependencies() {
    let plan = respond(json!({"version":1,"op":"plan","source":SOURCE,"view":"Board"})).unwrap();
    assert_eq!(plan["view_type"], "kanban");
    assert_eq!(plan["required_props"], json!(["score", "status"]));
}

#[test]
fn plan_says_each_summary_with_the_name_derive_gives_it() {
    let source = "views:\n  - name: T\n    type: table\n    summaries:\n      - {key: score, aggregate: sum}\n      - {key: stato, aggregate: count_filled}\n      - {name: Totale, key: score, aggregate: average, expression: 'prop.score * 2'}\n";
    let plan = respond(json!({"version":1,"op":"plan","source":source,"view":"T"})).unwrap();
    assert_eq!(
        plan["summaries"],
        json!([
            {"key":"score","aggregate":"sum","expression":null,"name":null,"label":"score:sum"},
            {"key":"stato","aggregate":"count_filled","expression":null,"name":null,"label":"stato:countfilled"},
            {"key":"score","aggregate":"average","expression":"prop.score * 2","name":"Totale","label":"Totale"}
        ])
    );
    let derived = respond(json!({"version":1,"op":"derive","source":source,"view":"T","now_ms":0,"rows":[
            {"doc":"a.md","props":{"score":{"kind":"number","value":2},"stato":{"kind":"text","value":"x"}}}
        ]}))
        .unwrap();
    for summary in plan["summaries"].as_array().unwrap() {
        let label = summary["label"].as_str().unwrap();
        assert!(
            derived["summaries"].get(label).is_some(),
            "{label} manca in derive"
        );
    }
    let bare =
        respond(json!({"version":1,"op":"plan","source":"views:\n  - name: N\n    type: table\n"}))
            .unwrap();
    assert_eq!(bare["summaries"], json!([]));
}

#[test]
fn plan_says_the_written_filter_sort_and_order() {
    let source = "views:\n  - name: T\n    type: table\n    order:\n      - file.name\n      - prop.stato\n    filters:\n      and:\n        - condition:\n            property: stato\n            op: is\n            value: Arrivata\n    sort:\n      - key: prop.stato\n        descending: true\n";
    let plan = respond(json!({"version":1,"op":"plan","source":source,"view":"T"})).unwrap();
    assert_eq!(plan["order"], json!(["file.name", "prop.stato"]));
    assert_eq!(
        plan["sort"],
        json!([{"key":"prop.stato","descending":true}])
    );
    let condition = &plan["filters"]["and"][0]["condition"];
    assert_eq!(condition["property"], "stato");
    assert_eq!(condition["op"], "is");
    assert_eq!(condition["value"], "Arrivata");
    // Una vista senza le tre chiavi: nessun filtro, nessun ordine, colonne
    // dedotte.
    let bare =
        respond(json!({"version":1,"op":"plan","source":"views:\n  - name: N\n    type: table\n"}))
            .unwrap();
    assert_eq!(bare["filters"], json!("all"));
    assert_eq!(bare["sort"], json!([]));
    assert_eq!(bare["order"], json!([]));
}

/// La Base come la crea «/base» su una cartella (IMP-147, IMP-413,
/// IMP-616): il piano non chiede nessuna proprietà, quindi la superficie
/// deve leggerle da sé per proporle. Quando la vista ne nomina una (una
/// colonna, un filtro su una data, le corsie), `derive` la usa.
#[test]
fn a_new_folder_base_plans_no_property_and_derives_the_ones_it_names() {
    let fresh = "filters:\n  condition:\n    file: path\n    op: in_folder\n    value: \"Redazione\"\nviews:\n  - name: \"Tabella\"\n    type: table\n";
    let plan = respond(json!({"version":1,"op":"plan","source":fresh,"view":"Tabella"})).unwrap();
    assert_eq!(plan["required_props"], json!([]));
    assert_eq!(plan["all_properties"], json!(false));
    assert_eq!(plan["columns"], json!([]));
    let day = |y: i32, m: u8, d: u8| json!({"kind":"date","value":{"year":y,"month":m,"day":d,"time":null}});
    let rows = json!([
        {"doc":"Redazione/Pane.md","props":{"stato":{"kind":"text","value":"Bozza"},"uscita":day(2026,11,28)}},
        {"doc":"Redazione/Brodo.md","props":{"stato":{"kind":"text","value":"Pubblicato"},"uscita":day(2026,12,12)}},
        {"doc":"Spesa/Mercato.md","props":{"uscita":day(2026,1,1)}}
    ]);
    let named = format!("{fresh}    order:\n      - stato\n    filters:\n      condition:\n        property: uscita\n        op: less_than\n        value: \"2026-12-01\"\n");
    let plan = respond(json!({"version":1,"op":"plan","source":named,"view":"Tabella"})).unwrap();
    assert_eq!(plan["required_props"], json!(["stato", "uscita"]));
    let derived = respond(
        json!({"version":1,"op":"derive","source":named,"view":"Tabella","now_ms":0,"rows":rows}),
    )
    .unwrap();
    let docs: Vec<_> = derived["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["doc"].clone())
        .collect();
    assert_eq!(docs, vec![json!("Redazione/Pane.md")]);
    assert_eq!(
        derived["rows"][0]["values"]["stato"],
        json!({"kind":"text","value":"Bozza"})
    );
}

/// IMP-1804: una Base dentro la cartella che filtra non elenca il suo
/// file `.base`, né quello di un'altra Base, nemmeno senza filtro.
#[test]
fn a_base_never_lists_base_files() {
    let folder = "filters:\n  condition:\n    file: path\n    op: in_folder\n    value: \"Progetti\"\nviews:\n  - name: \"Tabella\"\n    type: table\n";
    let open = "views:\n  - name: \"Tabella\"\n    type: table\n";
    let rows = json!([
        {"doc":"Progetti/Progetti.base","props":{}},
        {"doc":"Progetti/Altra.BASE","props":{}},
        {"doc":"Progetti/Sito.md","props":{}},
        {"doc":"Progetti/.base","props":{}},
        {"doc":"Progetti/base.md","props":{}}
    ]);
    for source in [folder, open] {
        let derived = respond(json!({"version":1,"op":"derive","source":source,"view":"Tabella","now_ms":0,"rows":rows})).unwrap();
        let docs: Vec<_> = derived["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["doc"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(
            docs,
            ["Progetti/.base", "Progetti/Sito.md", "Progetti/base.md"]
        );
    }
}

#[test]
fn parse_says_each_view_type_in_order() {
    let parsed = respond(json!({"version":1,"op":"parse","source":TIME_SOURCE})).unwrap();
    assert_eq!(
        parsed["views"].as_array().unwrap().len(),
        parsed["types"].as_array().unwrap().len()
    );
    let source = "views:\n  - name: A\n    type: kanban\n    group:\n      key: s\n  - name: B\n    type: table\n";
    let parsed = respond(json!({"version":1,"op":"parse","source":source})).unwrap();
    assert_eq!(parsed["views"], json!(["A", "B"]));
    assert_eq!(parsed["types"], json!(["kanban", "table"]));
}

#[test]
fn typed_rows_sort_and_summarize_before_view_limit() {
    let source = SOURCE.replace("    sort:", "    limit: 1\n    sort:");
    let derived = respond(json!({"version":1,"op":"derive","source":source,"view":"Board","now_ms":0,"rows":[
            {"doc":"a.md","props":{"status":{"kind":"empty"},"score":{"kind":"number","value":1}}},
            {"doc":"b.md","props":{"status":{"kind":"bool","value":false},"score":{"kind":"number","value":2}}}
        ]})).unwrap();
    assert_eq!(derived["rows"].as_array().unwrap().len(), 1);
    assert_eq!(derived["rows"][0]["doc"], "b.md");
    assert_eq!(
        derived["rows"][0]["values"]["status"],
        json!({"kind":"bool","value":false})
    );
    assert_eq!(
        derived["summaries"]["score:sum"],
        json!({"kind":"number","value":3.0})
    );
}

#[test]
fn query_never_clips_results_at_a_page_boundary() {
    let rows = (0..2001)
        .map(|index| json!({"doc":format!("{index:04}.md"),"props":{}}))
        .collect::<Vec<_>>();
    let derived = respond(
        json!({"version":1,"op":"derive","source":SOURCE,"view":"Board","now_ms":0,"rows":rows}),
    )
    .unwrap();
    assert_eq!(derived["rows"].as_array().unwrap().len(), 2001);
}
#[test]
fn heterogeneous_comparisons_do_not_turn_numbers_into_text() {
    let source = "filters:\n  condition: {property: score, op: greater_than, value: '9'}\nviews:\n  - {name: Filtered, type: table, order: [score]}\n";
    let derived = respond(
        json!({"version":1,"op":"derive","source":source,"view":"Filtered","now_ms":0,"rows":[
            {"doc":"number.md","props":{"score":{"kind":"number","value":10}}},
            {"doc":"text.md","props":{"score":{"kind":"text","value":"x"}}}
        ]}),
    )
    .unwrap();
    // Il numero non diventa testo: `10 > '9'` vale come numeri, mentre
    // come testo «10» verrebbe prima di «9». Il testo resta testo.
    let docs: Vec<_> = derived["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["doc"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(docs, ["number.md", "text.md"]);
}

/// Le righe che un filtro della vista lascia, su opere con una data, un
/// numero e uno stato.
fn kept(filter: &str) -> Vec<String> {
    let source =
        format!("views:\n  - name: T\n    type: table\n    filters:\n      condition: {filter}\n");
    let date =
        |m: u8, d: u8| json!({"kind":"date","value":{"year":2026,"month":m,"day":d,"time":null}});
    let derived = respond(json!({"version":1,"op":"derive","source":source,"view":"T","now_ms":0,"rows":[
            {"doc":"A.md","props":{"consegna":date(2,24),"valore":{"kind":"number","value":2600.0},"stato":{"kind":"text","value":"Arrivata"}}},
            {"doc":"B.md","props":{"consegna":date(3,18),"valore":{"kind":"number","value":7300.5},"stato":{"kind":"text","value":"In viaggio"}}}
        ]}))
        .unwrap();
    derived["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["doc"].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn una_data_e_un_numero_scritti_come_testo_si_confrontano_per_quello_che_sono() {
    assert_eq!(
        kept("{property: consegna, op: greater_than, value: '2026-03-01'}"),
        ["B.md"]
    );
    assert_eq!(
        kept("{property: consegna, op: less_than, value: '2026-03-01'}"),
        ["A.md"]
    );
    assert_eq!(
        kept("{property: consegna, op: is, value: '2026-03-18'}"),
        ["B.md"]
    );
    assert_eq!(
        kept("{property: consegna, op: is_not, value: '2026-03-18'}"),
        ["A.md"]
    );
    assert_eq!(
        kept("{property: valore, op: greater_than, value: '3000.5'}"),
        ["B.md"]
    );
    assert_eq!(kept("{property: valore, op: is, value: '2600'}"), ["A.md"]);
    assert_eq!(
        kept("{property: valore, op: contains, value: 2600}"),
        ["A.md"]
    );
    // La forma della lingua non è del file: «3000,5» resta un testo, e un
    // testo non si ordina con un numero.
    assert!(kept("{property: valore, op: greater_than, value: '3000,5'}").is_empty());
    // Una data che non si legge resta testo, e non trova niente.
    assert!(kept("{property: consegna, op: greater_than, value: 'marzo'}").is_empty());
}

/// Una data con l'orario e una data senza orario nel filtro: si confronta
/// il giorno civile, come lo mostra e lo scrive la barra.
#[test]
fn una_data_senza_orario_nel_filtro_confronta_il_giorno() {
    let kept = |filter: &str| -> Vec<String> {
        let source = format!(
            "views:\n  - name: T\n    type: table\n    filters:\n      condition: {filter}\n"
        );
        let at = |d: u8, hour: u8, offset: Value| json!({"kind":"date","value":{"year":2026,"month":3,"day":d,"time":{"hour":hour,"minute":30,"second":0,"offset_minutes":offset}}});
        let derived = respond(
            json!({"version":1,"op":"derive","source":source,"view":"T","now_ms":0,"rows":[
                // Il 18 all'una e mezza a +02:00: in UTC è ancora il 17.
                {"doc":"presto.md","props":{"consegna":at(18, 1, json!(120))}},
                {"doc":"sera.md","props":{"consegna":at(18, 21, json!(0))}},
                // Un orario senza fuso: l'istante non si sa, il giorno sì.
                {"doc":"locale.md","props":{"consegna":at(18, 9, Value::Null)}},
                {"doc":"dopo.md","props":{"consegna":at(19, 0, json!(0))}},
                {"doc":"prima.md","props":{"consegna":at(17, 23, json!(0))}}
            ]}),
        )
        .unwrap();
        derived["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["doc"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        kept("{property: consegna, op: is, value: '2026-03-18'}"),
        ["locale.md", "presto.md", "sera.md"]
    );
    assert_eq!(
        kept("{property: consegna, op: greater_than, value: '2026-03-18'}"),
        ["dopo.md"]
    );
    assert_eq!(
        kept("{property: consegna, op: less_than, value: '2026-03-18'}"),
        ["prima.md"]
    );
    // Con l'orario nel filtro si confronta l'istante: l'orario senza fuso
    // non ne ha uno, e non passa.
    assert_eq!(
        kept("{property: consegna, op: greater_than, value: '2026-03-18T12:00:00Z'}"),
        ["dopo.md", "sera.md"]
    );
}

#[test]
fn contiene_non_distingue_le_maiuscole_come_la_ricerca() {
    assert_eq!(
        kept("{property: stato, op: contains, value: arrivata}"),
        ["A.md"]
    );
    assert_eq!(
        kept("{property: stato, op: contains, value: VIAGGIO}"),
        ["B.md"]
    );
    assert_eq!(
        kept("{property: stato, op: not_contains, value: VIAGGIO}"),
        ["A.md"]
    );
}

#[test]
fn budgets_fail_instead_of_returning_a_partial_answer() {
    let oversized = json!({"version":1,"op":"parse","source":"x".repeat(MAX_BASE_QUERY_BYTES)});
    assert!(matches!(respond(oversized), Err(PluginError::BadArgs(_))));
    assert!(matches!(
        check_json_size(&json!("long answer"), 4, "risposta"),
        Err(PluginError::BadArgs(_))
    ));
    let definition = BaseDefinition::parse(SOURCE).unwrap();
    let plan = planned(&definition, Some("Board")).unwrap();
    let rows = (0..=MAX_BASE_ROWS_PER_CALL)
        .map(|index| InputRow {
            doc: format!("{index}.md"),
            props: BTreeMap::new(),
        })
        .collect();
    assert!(matches!(
        derive(&plan, rows, 0, None, Vec::new()),
        Err(PluginError::BadArgs(_))
    ));
}
#[test]
fn container_context_and_custom_summary_are_identical_for_embeds_and_standalone() {
    let source = "formulas:\n  - {name: host, expression: 'container.folder'}\n  - {name: doubled, expression: 'prop.score * 2'}\nviews:\n  - name: Board\n    type: table\n    order: [formula.host, formula.doubled]\n    limit: 1\n    summaries:\n      - {name: Total, key: score, aggregate: sum, expression: 'prop.score * 2'}\n";
    let input = json!({"version":1,"op":"derive","source":source,"view":"Board","container":"Projects/host.md","now_ms":0,"rows":[
        {"doc":"a.md","props":{"score":{"kind":"number","value":2}}},
        {"doc":"b.md","props":{"score":{"kind":"number","value":3}}}
    ]});
    let embedded = respond(input.clone()).unwrap();
    let standalone = respond(input).unwrap();
    assert_eq!(embedded, standalone);
    assert_eq!(
        embedded["rows"][0]["values"]["formula.host"],
        json!({"kind":"text","value":"Projects"})
    );
    assert_eq!(
        embedded["summaries"]["Total"],
        json!({"kind":"number","value":10.0})
    );
    let plan = respond(json!({"version":1,"op":"plan","source":source,"view":"Board"})).unwrap();
    assert_eq!(plan["required_props"], json!(["score"]));
}

/// Un riepilogo su una Relazione, come colonna e nel piede: il piano dice
/// quali link risolvere e quali proprietà chiedere, `derive` legge le note
/// legate della richiesta. Un link rotto non conta, una nota che lega sé
/// stessa sì, un giro di relazioni si ferma al primo livello, e una
/// richiesta senza `linked` (come quelle di oggi) dà zero e vuoto.
#[test]
fn a_rollup_reads_the_linked_notes_one_level_deep() {
    use fub_abi::model::LinkTarget;
    let relation = |pages: &[&str]| {
        serde_json::to_value(PropertyValue::List(
            pages
                .iter()
                .map(|page| PropertyScalar::Link(LinkTarget::wiki(*page)))
                .collect(),
        ))
        .unwrap()
    };
    let source = "formulas:\n  - {name: pagine, expression: 'rollup(prop.libri, \"sum\", \"pagine\")'}\n  - {name: quanti, expression: 'rollup(libri, \"count\")'}\nviews:\n  - name: T\n    type: table\n    order: [file.name, formula.pagine, formula.quanti]\n    summaries:\n      - {name: Media, key: libri, aggregate: average, expression: 'rollup(libri, \"max\", \"voto\")'}\n";
    let plan = respond(json!({"version":1,"op":"plan","source":source,"view":"T"})).unwrap();
    assert_eq!(plan["relations"], json!(["libri"]));
    assert_eq!(plan["linked_props"], json!(["pagine", "voto"]));
    assert_eq!(plan["required_props"], json!(["libri"]));
    let rows = json!([
        {"doc":"Scaffale.md","props":{"libri":relation(&["Dune", "Rotto", "Scaffale"])}},
        {"doc":"Dune.md","props":{"libri":relation(&["Scaffale"])}},
        {"doc":"Vuoto.md","props":{}}
    ]);
    let number = |n: f64| json!({"kind":"number","value":n});
    let linked = json!([
        {"target":"Dune","doc":"Dune.md","props":{"pagine":number(600.0),"voto":number(4.0),"libri":relation(&["Scaffale"])}},
        {"target":"Scaffale","doc":"Scaffale.md","props":{"pagine":number(10.0),"voto":number(2.0),"libri":relation(&["Dune"])}}
    ]);
    let derived = respond(json!({"version":1,"op":"derive","source":source,"view":"T","now_ms":0,"rows":rows,"linked":linked})).unwrap();
    let cell = |doc: &str, key: &str| {
        derived["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["doc"] == doc)
            .unwrap()["values"][key]
            .clone()
    };
    assert_eq!(cell("Scaffale.md", "formula.pagine"), number(610.0));
    assert_eq!(cell("Scaffale.md", "formula.quanti"), number(2.0));
    assert_eq!(cell("Dune.md", "formula.pagine"), number(10.0));
    assert_eq!(cell("Vuoto.md", "formula.quanti"), number(0.0));
    assert_eq!(cell("Vuoto.md", "formula.pagine"), json!({"kind":"empty"}));
    // Il piede: la media dei massimi per riga, sulle righe con un valore.
    assert_eq!(derived["summaries"]["Media"], number(3.0));
    // Senza `linked` ogni link è rotto: la richiesta di oggi resta valida.
    let without = respond(
        json!({"version":1,"op":"derive","source":source,"view":"T","now_ms":0,"rows":rows}),
    )
    .unwrap();
    assert_eq!(without["rows"][0]["values"]["formula.quanti"], number(0.0));
    // Una nota legata senza documento non si accetta.
    assert!(respond(
        json!({"version":1,"op":"derive","source":source,"view":"T","now_ms":0,"rows":rows,
            "linked":[{"target":"Dune","doc":"","props":{}}]})
    )
    .is_err());
    // Una base senza riepiloghi di Relazione dice due elenchi vuoti.
    let bare = respond(json!({"version":1,"op":"plan","source":SOURCE,"view":"Board"})).unwrap();
    assert_eq!(
        (bare["relations"].clone(), bare["linked_props"].clone()),
        (json!([]), json!([]))
    );
}

/// **Lo stesso link scritto in cartelle diverse porta a note diverse.**
/// Le note legate erano una per pagina di link: `[[Indice]]` in `A/` e in
/// `B/` prendevano tutte e due la nota della prima riga. Con `folder`
/// ognuna vale per le righe di quella cartella; senza, per tutte.
#[test]
fn a_rollup_reads_the_linked_note_of_the_row_folder() {
    use fub_abi::model::LinkTarget;
    let relation = |page: &str| {
        serde_json::to_value(PropertyValue::List(vec![PropertyScalar::Link(
            LinkTarget::wiki(page),
        )]))
        .unwrap()
    };
    let source = "formulas:\n  - {name: pagine, expression: 'rollup(prop.libri, \"sum\", \"pagine\")'}\nviews:\n  - name: T\n    type: table\n    order: [file.name, formula.pagine]\n";
    let rows = json!([
        {"doc":"A/Scaffale.md","props":{"libri":relation("Indice")}},
        {"doc":"B/Scaffale.md","props":{"libri":relation("Indice")}},
        {"doc":"Radice.md","props":{"libri":relation("Dune")}}
    ]);
    let number = |n: f64| json!({"kind":"number","value":n});
    let linked = json!([
        {"target":"Indice","folder":"A","doc":"A/Indice.md","props":{"pagine":number(1.0)}},
        {"target":"Indice","folder":"B","doc":"B/Indice.md","props":{"pagine":number(2.0)}},
        {"target":"Dune","doc":"Dune.md","props":{"pagine":number(600.0)}}
    ]);
    let derived = respond(json!({"version":1,"op":"derive","source":source,"view":"T","now_ms":0,"rows":rows,"linked":linked})).unwrap();
    let cell = |doc: &str| {
        derived["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["doc"] == doc)
            .unwrap()["values"]["formula.pagine"]
            .clone()
    };
    assert_eq!(cell("A/Scaffale.md"), number(1.0));
    assert_eq!(cell("B/Scaffale.md"), number(2.0));
    assert_eq!(
        cell("Radice.md"),
        number(600.0),
        "senza cartella vale per tutte"
    );
}

#[test]
fn defaults_only_include_entailed_equalities_and_cycles_stay_errors() {
    let source = "filters:\n  condition: {property: status, op: is, value: ready}\nformulas:\n  - {name: a, expression: 'formula.b + 1'}\n  - {name: b, expression: 'formula.a + 1'}\nviews:\n  - name: Board\n    type: table\n    order: [formula.a]\n    filters:\n      and:\n        - condition: {property: priority, op: is, value: 2}\n        - or:\n            - condition: {property: lane, op: is, value: Done}\n            - condition: {property: lane, op: is, value: Todo}\n";
    let plan = respond(json!({"version":1,"op":"plan","source":source})).unwrap();
    assert_eq!(
        plan["create_defaults"],
        json!({"priority":2,"status":"ready"})
    );
    let derived = respond(json!({"version":1,"op":"derive","source":source,"now_ms":0,"rows":[
            {"doc":"a.md","props":{"priority":{"kind":"number","value":2},"status":{"kind":"text","value":"ready"},"lane":{"kind":"text","value":"Done"}}}
        ]})).unwrap();
    assert_eq!(
        derived["rows"][0]["values"]["formula.a"],
        json!({"kind":"error","value":"cycle"})
    );
}

const TIME_SOURCE: &str = "views:\n  - name: Cal\n    type: table\n    fub:\n      view: calendar\n      date: prop.scadenza\n  - name: Lin\n    type: timeline\n    fub:\n      start: inizio\n      end: fine\n  - name: Nuda\n    type: calendar\n";

fn date(year: i32, month: u8, day: u8, time: Value) -> Value {
    json!({"kind":"date","value":{"year":year,"month":month,"day":day,"time":time}})
}

#[test]
fn il_piano_dice_le_proprieta_di_tempo_e_le_chiede_alla_lettura() {
    let calendar =
        respond(json!({"version":1,"op":"plan","source":TIME_SOURCE,"view":"Cal"})).unwrap();
    assert_eq!(calendar["view_type"], "calendar");
    assert_eq!(calendar["date_key"], "scadenza");
    assert_eq!(calendar["start_key"], Value::Null);
    assert_eq!(calendar["required_props"], json!(["scadenza"]));

    let timeline =
        respond(json!({"version":1,"op":"plan","source":TIME_SOURCE,"view":"Lin"})).unwrap();
    assert_eq!(timeline["view_type"], "timeline");
    assert_eq!(
        (timeline["start_key"].clone(), timeline["end_key"].clone()),
        (json!("inizio"), json!("fine"))
    );
    assert_eq!(timeline["required_props"], json!(["fine", "inizio"]));

    // Un calendario senza `fub:` si legge: la data manca, e lo dice il piano.
    let bare =
        respond(json!({"version":1,"op":"plan","source":TIME_SOURCE,"view":"Nuda"})).unwrap();
    assert_eq!(bare["view_type"], "calendar");
    assert_eq!(bare["date_key"], Value::Null);
}

#[test]
fn il_calendario_dice_il_giorno_di_ogni_nota_e_l_ora_non_lo_sposta() {
    let derived = respond(json!({"version":1,"op":"derive","source":TIME_SOURCE,"view":"Cal","now_ms":0,"rows":[
            {"doc":"a.md","props":{"scadenza":date(2026, 11, 14, Value::Null)}},
            {"doc":"b.md","props":{"scadenza":date(2026, 11, 14, json!({"hour":23,"minute":30,"second":0,"offset_minutes":120}))}},
            {"doc":"c.md","props":{"scadenza":{"kind":"text","value":"domani"}}},
            {"doc":"d.md","props":{}}
        ]})).unwrap();
    assert_eq!(derived["rows"][0]["time"], json!({"day":"2026-11-14"}));
    assert_eq!(derived["rows"][1]["time"], json!({"day":"2026-11-14"}));
    assert_eq!(derived["rows"][2]["time"], json!({"day":null}));
    assert_eq!(derived["rows"][3]["time"], json!({"day":null}));
}

#[test]
fn la_linea_del_tempo_dice_inizio_e_fine_e_segna_la_fine_prima_dell_inizio() {
    let derived = respond(json!({"version":1,"op":"derive","source":TIME_SOURCE,"view":"Lin","now_ms":0,"rows":[
            {"doc":"a.md","props":{"inizio":date(2026, 11, 10, Value::Null),"fine":date(2026, 11, 12, Value::Null)}},
            {"doc":"b.md","props":{"inizio":date(2026, 11, 12, Value::Null),"fine":date(2026, 11, 10, Value::Null)}},
            {"doc":"c.md","props":{"inizio":date(2026, 11, 10, Value::Null)}},
            {"doc":"d.md","props":{"fine":date(2026, 11, 10, Value::Null)}}
        ]})).unwrap();
    assert_eq!(
        derived["rows"][0]["time"],
        json!({"start":"2026-11-10","end":"2026-11-12","inverted":false})
    );
    assert_eq!(
        derived["rows"][1]["time"],
        json!({"start":"2026-11-12","end":"2026-11-10","inverted":true})
    );
    assert_eq!(
        derived["rows"][2]["time"],
        json!({"start":"2026-11-10","end":null,"inverted":false})
    );
    assert_eq!(
        derived["rows"][3]["time"],
        json!({"start":null,"end":"2026-11-10","inverted":false})
    );
}

/// Trascinare una nota su un giorno riscrive la data del calendario, che
/// non è una colonna della vista; un'altra proprietà resta non scrivibile.
#[test]
fn il_calendario_scrive_la_sua_data_anche_se_non_e_una_colonna() {
    let edit = |key: &str| {
        respond(
            json!({"version":1,"op":"mutate","source":TIME_SOURCE,"view":"Cal","edits":[
                {"doc":"a.md","key":key,"expected":{"kind":"absent"},"value":"2026-11-15"}
            ]}),
        )
    };
    let written = edit("scadenza").unwrap();
    assert_eq!(written["mutations"][0]["command"], "note.property.set");
    assert_eq!(written["mutations"][0]["args"]["key"], "scadenza");
    assert!(edit("altro").is_err());
    // La linea del tempo: inizio e fine.
    let timeline = respond(
        json!({"version":1,"op":"mutate","source":TIME_SOURCE,"view":"Lin","edits":[
            {"doc":"a.md","key":"fine","expected":{"kind":"absent"},"value":"2026-11-15"}
        ]}),
    );
    assert!(timeline.is_ok());
}

/// Una colonna `prop.stato` scrive la proprietà `stato` della nota: il
/// comando riceve il nome del frontmatter, senza il prefisso della vista
/// (IMP-123). La chiave di colonna resta quella della vista nel suo eco,
/// e una colonna che la vista non ha resta rifiutata.
#[test]
fn una_colonna_prop_scrive_la_proprieta_senza_il_prefisso() {
    let source = "views:\n  - name: Tab\n    type: table\n    order:\n      - file.name\n      - prop.stato\n      - valore\n";
    let edit = |key: &str| {
        respond(
            json!({"version":1,"op":"mutate","source":source,"view":"Tab","edits":[
                {"doc":"a.md","key":key,"expected":{"kind":"absent"},"value":"Confermata"}
            ]}),
        )
    };
    let written = edit("prop.stato").unwrap();
    assert_eq!(written["mutations"][0]["key"], "prop.stato");
    assert_eq!(written["mutations"][0]["command"], "note.property.set");
    assert_eq!(written["mutations"][0]["args"]["key"], "stato");
    assert_eq!(
        edit("valore").unwrap()["mutations"][0]["args"]["key"],
        "valore"
    );
    assert!(edit("prop.altro").is_err());
}

/// Le viste che non sono di tempo non portano il campo `time`.
#[test]
fn una_tabella_non_porta_il_tempo() {
    let table = format!("{TIME_SOURCE}  - name: Tab\n    type: table\n");
    let derived = respond(
        json!({"version":1,"op":"derive","source":table,"view":"Tab","now_ms":0,"rows":[
            {"doc":"a.md","props":{"scadenza":date(2026, 11, 14, Value::Null)}}
        ]}),
    )
    .unwrap();
    assert!(derived["rows"][0].get("time").is_none());
}
