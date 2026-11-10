//! Test del valutatore di formule.

use super::*;

fn ctx() -> RowContext {
    RowContext {
        props: BTreeMap::from([
            ("status".into(), BaseValue::Text("done".into())),
            ("rating".into(), BaseValue::Number(4.5)),
            (
                "tags".into(),
                BaseValue::List(vec![BaseValue::Text("a".into())]),
            ),
        ]),
        file: BTreeMap::from([("name".into(), BaseValue::Text("note.md".into()))]),
        container: BTreeMap::from([("folder".into(), BaseValue::Text("Projects".into()))]),
        formulas: BTreeMap::new(),
        now_ms: 0,
    }
}

fn value_of(source: &str) -> BaseValue {
    let formula = Formula::parse(source).unwrap();
    formula.evaluate(&ctx(), &mut EvalBudget::new(MAX_FORMULA_STEPS))
}

#[test]
fn tipi_operatori_e_funzioni() {
    assert_eq!(value_of("1 + 2 * 3"), BaseValue::Number(7.0));
    assert_eq!(
        value_of("if(rating >= 4, \"top\", \"altro\")"),
        BaseValue::Text("top".into())
    );
    assert_eq!(value_of("tags.contains(\"a\")"), BaseValue::Bool(true));
    assert_eq!(value_of("status.upper()"), BaseValue::Text("DONE".into()));
    assert_eq!(
        value_of("1 / 0"),
        BaseValue::Error(FormulaErrorCode::DivZero)
    );
}
#[test]
fn funzioni_di_testo_numeri_date_e_file_alla_maniera_di_obsidian() {
    let day = "date('2026-10-19')";
    let cases = [
        (
            "title('hello wORLD of fub')",
            BaseValue::Text("Hello World Of Fub".into()),
        ),
        ("status.title()", BaseValue::Text("Done".into())),
        ("repeat('ab', 3)", BaseValue::Text("ababab".into())),
        ("matches('Fub 2026', 'b [0-9]+')", BaseValue::Bool(true)),
        ("matches('Fub', '^x')", BaseValue::Bool(false)),
        (
            "escapeHTML('<a href=\"x\">&</a>')",
            BaseValue::Text("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;".into()),
        ),
        ("toFixed(3.14159, 2)", BaseValue::Text("3.14".into())),
        ("toFixed(2, 0)", BaseValue::Text("2".into())),
        (
            &format!("format({day}, 'YYYY-MM-DD')"),
            BaseValue::Text("2026-10-19".into()),
        ),
        (
            &format!("format({day}, 'dddd D MMMM YY [at] HH:mm')"),
            BaseValue::Text("Monday 19 October 26 at 00:00".into()),
        ),
        (&format!("time({day})"), BaseValue::Text("00:00:00".into())),
        ("hasTag(prop.tags, 'a')", BaseValue::Bool(true)),
        ("hasTag(prop.tags, 'b', 'a')", BaseValue::Bool(true)),
        ("hasTag(prop.tags, 'b')", BaseValue::Bool(false)),
        ("hasTag(['a/b'], 'a')", BaseValue::Bool(true)),
        ("hasTag(['ab'], 'a')", BaseValue::Bool(false)),
        ("hasProperty('rating')", BaseValue::Bool(true)),
        ("hasProperty('assente')", BaseValue::Bool(false)),
        (
            "hasLink([link('B.md'), link('C')], 'C.md')",
            BaseValue::Bool(true),
        ),
        ("linksTo([link('B')], 'Z')", BaseValue::Bool(false)),
        (
            "inFolder(file('Projects/x/t.md'), 'Projects')",
            BaseValue::Bool(true),
        ),
        (
            "inFolder(file('Projectsx/t.md'), 'Projects')",
            BaseValue::Bool(false),
        ),
        (
            "asLink(file('a/b.md'), 'Ciao').target",
            BaseValue::Text("a/b.md".into()),
        ),
        (
            "asFile(link('a/b.md')).path",
            BaseValue::Text("a/b.md".into()),
        ),
        (
            "repeat('x', 1e9)",
            BaseValue::Error(FormulaErrorCode::Value),
        ),
        ("toFixed(1, 99)", BaseValue::Error(FormulaErrorCode::Value)),
        (
            "matches('a', '(')",
            BaseValue::Error(FormulaErrorCode::Value),
        ),
        (
            "format('non una data', 'YYYY')",
            BaseValue::Error(FormulaErrorCode::Value),
        ),
    ];
    for (source, expected) in cases {
        assert_eq!(value_of(source), expected, "{source}");
    }
}

#[test]
fn filter_map_e_reduce_valutano_l_espressione_per_ogni_elemento() {
    let n = |x: f64| BaseValue::Number(x);
    assert_eq!(
        value_of("[1, 2, 3, 4].filter(value > 2)"),
        BaseValue::List(vec![n(3.0), n(4.0)])
    );
    assert_eq!(
        value_of("[1, 2, 3].map(value * 10 + index)"),
        BaseValue::List(vec![n(10.0), n(21.0), n(32.0)])
    );
    assert_eq!(value_of("[1, 2, 3].reduce(acc + value, 0)"), n(6.0));
    assert_eq!(value_of("reduce([], acc + value, 5)"), n(5.0));
    // `value` copre la proprietà solo dentro l'espressione.
    assert_eq!(
        value_of("[1].map(status)"),
        BaseValue::List(vec![BaseValue::Text("done".into())])
    );
    assert_eq!(
        value_of("'abc'.filter(value)"),
        BaseValue::Error(FormulaErrorCode::Value)
    );
    assert_eq!(
        value_of("[1, 2].map(value / 0)"),
        BaseValue::Error(FormulaErrorCode::DivZero)
    );
    assert_eq!(
        value_of("[1].reduce(acc + value)"),
        BaseValue::Error(FormulaErrorCode::Value)
    );
    // Una lista lunga si ferma al budget, non gira all'infinito.
    let formula = Formula::parse("[1, 2, 3].map(value)").unwrap();
    assert_eq!(
        formula.evaluate(&ctx(), &mut EvalBudget::new(4)),
        BaseValue::Error(FormulaErrorCode::Budget)
    );
}

#[test]
fn relative_dice_quanto_manca_o_e_passato() {
    let at = |delta_ms: i64| relative_time(delta_ms, 0);
    assert_eq!(at(10_000), "just now");
    assert_eq!(at(-3 * 60_000), "3 minutes ago");
    assert_eq!(at(60 * 60_000), "in 1 hour");
    assert_eq!(at(-3 * 86_400_000), "3 days ago");
    assert_eq!(at(400 * 86_400_000), "in 1 year");
}

#[test]
fn la_data_civile_regge_epoca_bisestili_e_prima_del_1970() {
    assert_eq!(civil_from_days(0), (1970, 1, 1));
    assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    assert_eq!(civil_from_days(-1), (1969, 12, 31));
    assert_eq!(
        format_date(-1, "YYYY-MM-DD HH:mm:ss"),
        "1969-12-31 23:59:59"
    );
}

#[test]
fn frozen_list_object_link_tag_folder_matrix_and_typed_unknowns() {
    assert_eq!(
        value_of("slice('abcd', 1, 3)"),
        BaseValue::Text("bc".into())
    );
    assert_eq!(
        value_of("slice([1, 2, 3], 1)"),
        BaseValue::List(vec![BaseValue::Number(2.0), BaseValue::Number(3.0)])
    );
    let cases = [
        ("[3, 1, 3].unique().length", BaseValue::Number(2.0)),
        (
            "object('owner', 'Ada', 'score', 2).owner",
            BaseValue::Text("Ada".into()),
        ),
        (
            "object('status', true).has('status')",
            BaseValue::Bool(true),
        ),
        ("object('status', true).get('missing')", BaseValue::Empty),
        (
            "object('status', true).keys().first()",
            BaseValue::Text("status".into()),
        ),
        (
            "object('rating', 2).values().first()",
            BaseValue::Number(2.0),
        ),
        ("tags(prop.tags).contains('a')", BaseValue::Bool(true)),
        (
            "folder(file('Projects/task.md'))",
            BaseValue::Text("Projects".into()),
        ),
        (
            "folder(link('Projects/task.md'))",
            BaseValue::Text("Projects".into()),
        ),
        (
            "link('target.md', 'Label').target",
            BaseValue::Text("target.md".into()),
        ),
        ("container.folder", BaseValue::Text("Projects".into())),
        ("object('a')", BaseValue::Error(FormulaErrorCode::Value)),
        (
            "imaginary(prop.tags)",
            BaseValue::Error(FormulaErrorCode::Name),
        ),
    ];
    for (source, expected) in cases {
        assert_eq!(value_of(source), expected, "{source}");
    }
}

/// I100: dentro gli 8 KiB ammessi, ogni forma che scende di un livello
/// è un errore di parsing e non uno stack esaurito prima del valutatore.
/// Gira su un thread di 1,5 MiB, tre quarti di quello di un test o di un
/// worker di tokio: in debug la discesa più profonda deve starci con
/// margine, su ogni piattaforma (con la 1.95 su macOS, prima di
/// `parse_binary`, non ci stava nemmeno in 2 MiB).
#[test]
fn un_annidamento_ostile_e_un_errore_non_uno_stack_esaurito() {
    std::thread::Builder::new()
        .stack_size(3 * 512 * 1024)
        .spawn(annidamenti_ostili)
        .expect("il thread parte")
        .join()
        .expect("nessuno stack esaurito");
}

fn annidamenti_ostili() {
    let deep = MAX_FORMULA_BYTES / 2 - 1;
    let hostile = [
        format!("{}1{}", "(".repeat(deep), ")".repeat(deep)),
        format!("{}1{}", "[".repeat(deep), "]".repeat(deep)),
        format!("{}1", "-".repeat(deep * 2 - 1)),
        format!("{}1", "!".repeat(deep * 2 - 1)),
        vec!["1"; deep].join("+"),
        vec!["1"; deep / 2].join("||"),
        format!("status{}", ".x".repeat(deep - 4)),
        format!("{}1{}", "abs(".repeat(deep / 3), ")".repeat(deep / 3)),
    ];
    for source in hostile {
        assert!(source.len() <= MAX_FORMULA_BYTES, "{}", source.len());
        assert!(
            matches!(Formula::parse(&source), Err(EvalError::Parse(_))),
            "{}",
            &source[..16]
        );
    }
}

/// Il tetto del parser non restringe quello semantico: una formula al
/// limite del valutatore si legge e si valuta, e un livello oltre resta
/// il rifiuto del valutatore di sempre.
#[test]
fn il_tetto_del_parser_non_restringe_il_valutatore() {
    let at_limit = format!("{}1", "-".repeat(MAX_FORMULA_DEPTH));
    assert_eq!(value_of(&at_limit), BaseValue::Number(1.0));
    let parens = format!(
        "{}1{}",
        "(".repeat(MAX_PARSE_DEPTH - 1),
        ")".repeat(MAX_PARSE_DEPTH - 1)
    );
    assert_eq!(value_of(&parens), BaseValue::Number(1.0));
    let beyond = format!("{}1", "-".repeat(MAX_FORMULA_DEPTH + 1));
    assert_eq!(value_of(&beyond), BaseValue::Error(FormulaErrorCode::Parse));
}

#[test]
fn funzione_sconosciuta_e_un_errore_non_un_valore() {
    assert_eq!(
        value_of("pippo(status)"),
        BaseValue::Error(FormulaErrorCode::Name)
    );
    assert!(Formula::parse("status == ").is_err());
}

#[test]
fn budget_e_valori_mancanti() {
    let formula = Formula::parse("prop.manca + 1").unwrap();
    assert_eq!(
        formula.evaluate(&ctx(), &mut EvalBudget::new(MAX_FORMULA_STEPS)),
        BaseValue::Error(FormulaErrorCode::Value)
    );
    let mut budget = EvalBudget::new(1);
    let formula = Formula::parse("1 + 1 + 1 + 1").unwrap();
    assert_eq!(
        formula.evaluate(&ctx(), &mut budget),
        BaseValue::Error(FormulaErrorCode::Budget)
    );
}
