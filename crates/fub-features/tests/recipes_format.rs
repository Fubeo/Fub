#![cfg(feature = "recipes")]
//! Il formato delle ricette: la lettura del blocco `fub-recipe` da una nota
//! letta dal formato Markdown vero, un caso per ogni codice di problema, le
//! righe dei problemi, il segnaposto esatto che tiene il tipo, l'impronta, la
//! spec che nasce e i controlli contro le spec vere delle feature ufficiali.

use fub_abi::command::{CommandReach, CommandSpec, CommandSurface, ParamKind};
use fub_abi::format::{DocumentSource, ParseContext};
use fub_abi::locale::Locale;
use fub_abi::text::Strings;
use fub_abi::FormatProvider;
use fub_features::every_official_feature;
use fub_features::recipes::{
    catalog, check_against, check_unique, expand, fingerprint, parse, spec, Problem, ProblemCode,
    Recipe, RECIPES_MAX,
};
use fub_features::vocabulary::{context_at, Ctx};
use fub_format_markdown::MarkdownProvider;
use serde_json::{json, Value};

/// Le spec di tutti i comandi delle feature ufficiali di questa build.
fn registry() -> Vec<CommandSpec> {
    every_official_feature()
        .iter()
        .filter_map(|feature| feature.commands)
        .flat_map(|provider| provider().commands())
        .collect()
}

/// I problemi della lettura di `source` (la ricetta non si legge).
fn problems(source: &str) -> Vec<Problem> {
    match read(source) {
        Ok(recipe) => panic!("doveva avere problemi, si legge: {recipe:?}"),
        Err(problems) => problems,
    }
}

fn read(source: &str) -> Result<Recipe, Vec<Problem>> {
    let model = MarkdownProvider::new()
        .parse(
            &DocumentSource::Text(source.into()),
            &ParseContext::obsidian("Recipes/Prova.md"),
        )
        .expect("il Markdown si legge");
    parse(&model, source)
}

fn recipe(source: &str) -> Recipe {
    read(source).unwrap_or_else(|problems| panic!("non si legge: {problems:#?}"))
}

/// Una nota con un titolo, una riga di testo e il blocco `yaml`: il blocco
/// apre alla riga 5, la prima riga YAML è la 6.
fn note(yaml: &str) -> String {
    format!("# Ricetta\n\nUna riga per chi legge.\n\n```fub-recipe\n{yaml}\n```\n")
}

/// Una ricetta valida da cambiare: un passo, i campi obbligatori.
fn minimal(extra: &str, steps: &str) -> String {
    note(&format!(
        "fub-recipe: 1\nid: prova\ntitle: Prova\ndescription: Una prova.\n{extra}steps:\n{steps}"
    ))
}

const ONE_STEP: &str = "  - run: note.property.set\n    args:\n      doc: \"{{doc}}\"\n      key: fatto\n      value: \"sì\"";

fn codes(problems: &[Problem]) -> Vec<ProblemCode> {
    problems.iter().map(|p| p.code).collect()
}

fn has(problems: &[Problem], code: ProblemCode, field: &str) -> bool {
    problems.iter().any(|p| p.code == code && p.field == field)
}

/// Il blocco d'esempio della pagina: è quello che scrive `recipes.new`
/// (`recipes.rs` lo prova nei suoi test).
fn page_example() -> String {
    let page = include_str!("../../../docs/reference/ricette.md");
    let start = page.find("```yaml\n").expect("la pagina mostra il blocco") + 8;
    let end = start + page[start..].find("```").expect("il blocco chiude");
    note(page[start..end].trim_end())
}

fn ctx() -> Ctx {
    Ctx {
        date: "2026-03-04".into(),
        time: "09:05".into(),
        datetime: "2026-03-04 09:05".into(),
        year: "2026".into(),
        month: "03".into(),
        day: "04".into(),
        hour: "09".into(),
        minute: "05".into(),
    }
}

#[test]
fn la_ricetta_d_esempio_passa_ogni_controllo() {
    let recipe = recipe(&page_example());
    assert_eq!(recipe.id, "archivia-la-nota");
    assert_eq!(recipe.steps.len(), 2);
    assert_eq!(check_against(&recipe, &registry()), []);

    let spec = spec(&recipe, &registry());
    assert_eq!(spec.id, "recipe.archivia-la-nota:run");
    assert_eq!(spec.title.as_literal(), Some("Archivia la nota"));
    assert!(spec.scope.writes && spec.scope.reversible);
    assert_eq!(spec.scope.reach, CommandReach::Documents, "la rinomina");
    let names: Vec<&str> = spec.params.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["doc"]);
    assert!(spec.params[0].required);

    let steps = expand(&recipe, &json!({ "doc": "Progetti/Piano.md" }), &ctx()).unwrap();
    assert_eq!(
        steps,
        [
            (
                "note.property.set".to_string(),
                json!({ "doc": "Progetti/Piano.md", "key": "archiviata", "value": "2026-03-04" })
            ),
            (
                "note.rename".to_string(),
                json!({ "doc": "Progetti/Piano.md", "to": "Archivio/Piano.md" })
            ),
        ]
    );
}

#[test]
fn blocco_assente_anche_nella_nota_vuota() {
    for source in [
        "",
        "# Leggimi\n\nNiente ricette qui.\n",
        "```yaml\nid: x\n```\n",
    ] {
        let found = problems(source);
        assert_eq!(codes(&found), [ProblemCode::BloccoAssente], "{source:?}");
        assert_eq!(found[0].line, None);
    }
}

#[test]
fn blocchi_doppi_con_la_riga_di_ognuno() {
    let source = format!("{}\n{}", minimal("", ONE_STEP), minimal("", ONE_STEP));
    let found = problems(&source);
    assert_eq!(codes(&found), [ProblemCode::BlocchiDoppi; 2]);
    assert_eq!(found[0].line, Some(5));
    assert!(found[1].line > found[0].line);
}

#[test]
fn yaml_che_non_si_legge_con_la_sua_riga() {
    let found = problems(&note("fub-recipe: 1\nid: [prova\ntitle: x"));
    assert_eq!(codes(&found), [ProblemCode::Yaml]);
    assert!(found[0].line.unwrap() >= 6, "{found:?}");

    let found = problems(&note("- una\n- lista"));
    assert_eq!(codes(&found), [ProblemCode::Yaml]);

    let found = problems(&note("fub-recipe: 1\nfub-recipe: 1\nid: x"));
    assert_eq!(codes(&found), [ProblemCode::Yaml], "una chiave ripetuta");
}

#[test]
fn yaml_oltre_il_budget() {
    let deep = format!(
        "fub-recipe: 1\nid: {}{}",
        "[".repeat(20_000),
        "]".repeat(20_000)
    );
    let found = problems(&note(&deep));
    assert_eq!(codes(&found), [ProblemCode::Yaml]);
    assert_eq!(found[0].line, Some(5));
}

#[test]
fn campo_sconosciuto_e_la_lettura_va_avanti() {
    let found = problems(&minimal(
        "colore: blu\n",
        "  - run: note.property.set\n    when: sempre\n    args: {}",
    ));
    assert!(
        has(&found, ProblemCode::CampoSconosciuto, "colore"),
        "{found:#?}"
    );
    assert!(has(&found, ProblemCode::CampoSconosciuto, "steps[0].when"));
    assert_eq!(found.len(), 2, "{found:#?}");
}

#[test]
fn campo_mancante() {
    let found = problems(&note("fub-recipe: 1\nid: prova"));
    for field in ["title", "description", "steps"] {
        assert!(
            has(&found, ProblemCode::CampoMancante, field),
            "{field}: {found:#?}"
        );
    }
    let found = problems(&note(""));
    assert!(
        has(&found, ProblemCode::CampoMancante, "fub-recipe"),
        "{found:#?}"
    );
}

#[test]
fn valori_non_validi() {
    let cases: &[(&str, &str, &str)] = &[
        ("", "id: Prova", "id"),
        ("", &format!("id: {}", "a".repeat(49)), "id"),
        ("", "id: con spazio", "id"),
        ("keybinding: Meta-k\n", "id: prova", "keybinding"),
        ("surfaces: [slash, menu]\n", "id: prova", "surfaces[1]"),
        (
            "params:\n  - name: x\n    title: X\n    kind: data\n",
            "id: prova",
            "params[0].kind",
        ),
        (
            "params:\n  - name: x\n    title: X\n    kind: choice\n",
            "id: prova",
            "params[0].options",
        ),
        (
            "params:\n  - name: x\n    title: X\n    kind: text\n  - name: x\n    title: Y\n    kind: text\n",
            "id: prova",
            "params[1].name",
        ),
        (
            "params:\n  - name: doc\n    title: X\n    kind: text\n",
            "id: prova",
            "params[0].name",
        ),
    ];
    for (extra, id, field) in cases {
        let source = note(&format!(
            "fub-recipe: 1\n{id}\ntitle: Prova\ndescription: Una prova.\n{extra}steps:\n{ONE_STEP}"
        ));
        let found = problems(&source);
        assert!(
            has(&found, ProblemCode::ValoreNonValido, field),
            "{field}: {found:#?}"
        );
    }
}

#[test]
fn da_uno_a_venti_passi() {
    let step = "  - run: note.property.set\n    args: { key: k, value: v }\n";
    let found = problems(&minimal("", &step.repeat(21)));
    assert!(
        has(&found, ProblemCode::ValoreNonValido, "steps"),
        "{found:#?}"
    );
    let found = problems(&note(
        "fub-recipe: 1\nid: prova\ntitle: Prova\ndescription: Una prova.\nsteps: []",
    ));
    assert!(
        has(&found, ProblemCode::ValoreNonValido, "steps"),
        "{found:#?}"
    );
    let twenty = recipe(&minimal("", &step.repeat(20)));
    assert_eq!(twenty.steps.len(), 20);
}

#[test]
fn versione_futura_resta_spenta_con_un_problema_solo() {
    let found = problems(&note(
        "fub-recipe: 2\nid: prova\ntitle: Prova\ndescription: x\ncampo-nuovo: sì\nsteps: []",
    ));
    assert_eq!(codes(&found), [ProblemCode::VersioneFutura]);
    assert_eq!(found[0].field, "fub-recipe");
    assert_eq!(found[0].line, Some(6));
    let found = problems(&minimal("", ONE_STEP).replace("fub-recipe: 1", "fub-recipe: zero"));
    assert!(has(&found, ProblemCode::ValoreNonValido, "fub-recipe"));
}

#[test]
fn segnaposto_sconosciuti() {
    let steps = "  - run: note.property.set\n    args:\n      key: \"{{param.x}}\"\n      value: \"{{random}}-{{ title }}\"";
    let found = problems(&minimal("", steps));
    let unknown: Vec<&str> = found
        .iter()
        .filter(|p| p.code == ProblemCode::SegnapostoSconosciuto)
        .map(|p| p.field.as_str())
        .collect();
    assert_eq!(
        unknown,
        [
            "steps[0].args.key",
            "steps[0].args.value",
            "steps[0].args.value"
        ],
        "{found:#?}"
    );
    // Lo stesso `{{param.x}}`, con il parametro dichiarato, va.
    let declared = "params:\n  - name: x\n    title: X\n    kind: text\n";
    let steps = "  - run: note.property.set\n    args:\n      key: \"{{param.x}}\"\n      value: \"{{datetime}} {{folder}} {{selection}}\"";
    recipe(&minimal(declared, steps));
}

#[test]
fn i_controlli_contro_il_registro() {
    let steps = [
        "  - run: nessuno.comando",
        "  - run: recipe.altra:run",
        "  - run: property.type.set",
        "    args: { key: k, type: text }",
        "  - run: trash.empty",
        "  - run: note.rename",
        "    args: { doc: \"{{doc}}\", verso: x }",
    ]
    .join("\n");
    let steps = steps.as_str();
    let recipe = recipe(&minimal("", steps));
    let found = check_against(&recipe, &registry());
    let expected = [
        (ProblemCode::ComandoSconosciuto, "steps[0].run"),
        (ProblemCode::ComandoRicetta, "steps[1].run"),
        (ProblemCode::Impostazioni, "steps[2].run"),
        (ProblemCode::NonSiAnnulla, "steps[3].run"),
        (ProblemCode::Argomenti, "steps[4].args"),
    ];
    for (code, field) in expected {
        assert!(has(&found, code, field), "{code} {field}: {found:#?}");
    }
    // `property.type.set` non si annulla **e** cambia le impostazioni.
    assert!(has(&found, ProblemCode::NonSiAnnulla, "steps[2].run"));
    // Le righe: il primo passo è alla riga 11 della nota.
    let first = found.iter().find(|p| p.field == "steps[0].run").unwrap();
    assert_eq!(first.line, Some(11));
}

#[test]
fn gli_argomenti_si_provano_col_tipo_dei_segnaposto() {
    // `{{param.n}}` è un numero: a un argomento di testo non va bene.
    let declared = "params:\n  - name: n\n    title: N\n    kind: number\n";
    let steps = "  - run: note.property.set\n    args:\n      doc: \"{{doc}}\"\n      key: k\n      value: \"{{param.n}}\"";
    let found = check_against(&recipe(&minimal(declared, steps)), &registry());
    assert!(
        has(&found, ProblemCode::Argomenti, "steps[0].args"),
        "{found:#?}"
    );
    // Dentro un testo, invece, diventa testo.
    let steps = steps.replace("\"{{param.n}}\"", "\"n={{param.n}}\"");
    assert_eq!(
        check_against(&recipe(&minimal(declared, &steps)), &registry()),
        []
    );
}

#[test]
fn il_segnaposto_esatto_tiene_il_tipo() {
    let declared = "params:\n  - name: n\n    title: N\n    kind: number\n  - name: forte\n    title: Forte\n    kind: bool\n  - name: nota\n    title: Nota\n    kind: text\n";
    let steps = "  - run: x.y\n    args:\n      numero: \"{{param.n}}\"\n      testo: \"n={{param.n}}\"\n      flag: \"{{param.forte}}\"\n      assente: \"{{param.nota}}\"\n      vuoto: \"[{{param.nota}}]\"\n      lista: [\"{{year}}\", 3]";
    let recipe = recipe(&minimal(declared, steps));
    let steps = expand(&recipe, &json!({ "n": 3, "forte": true }), &ctx()).unwrap();
    assert_eq!(
        steps[0].1,
        json!({
            "numero": 3,
            "testo": "n=3",
            "flag": true,
            "assente": null,
            "vuoto": "[]",
            "lista": ["2026", 3],
        })
    );
}

#[test]
fn expand_riempie_nota_cartella_selezione_e_rifiuta_gli_argomenti_sbagliati() {
    let steps = "  - run: x.y\n    args:\n      a: \"{{title}}|{{folder}}|{{selection}}|{{time}}\"";
    let recipe = recipe(&minimal("", steps));
    let steps = expand(
        &recipe,
        &json!({ "doc": "Nota.md", "selection": "ciao" }),
        &ctx(),
    )
    .unwrap();
    assert_eq!(steps[0].1, json!({ "a": "Nota||ciao|09:05" }));
    // Un `{{selection}}` vuole la selezione: senza, `argomenti`.
    let missing = expand(&recipe, &json!({ "doc": "Nota.md" }), &ctx()).unwrap_err();
    assert_eq!(missing.code, ProblemCode::Argomenti);
    // I valori non si riespandono: una selezione che contiene `{{date}}`
    // resta com'è.
    let steps = expand(
        &recipe,
        &json!({ "doc": "A/B/N.md", "selection": "{{date}}" }),
        &ctx(),
    )
    .unwrap();
    assert_eq!(steps[0].1, json!({ "a": "N|A/B|{{date}}|09:05" }));
}

#[test]
fn la_spec_dice_selezione_nota_e_parametri_in_quest_ordine() {
    let declared = "keybinding: Mod-Alt-r\nsurfaces: [slash, slash]\nparams:\n  - name: dove\n    title: Dove\n    kind: choice\n    required: true\n    options: [qui, là]\n";
    let steps = "  - run: note.property.set\n    args:\n      doc: \"{{doc}}\"\n      key: k\n      value: \"{{selection}} {{param.dove}}\"";
    let recipe = recipe(&minimal(declared, steps));
    assert_eq!(check_against(&recipe, &registry()), []);
    let spec = spec(&recipe, &registry());
    let names: Vec<&str> = spec.params.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["selection", "doc", "dove"]);
    assert!(spec.params[2].required);
    assert!(matches!(&spec.params[2].kind, ParamKind::Choice(c) if c.len() == 2));
    assert_eq!(
        spec.surfaces,
        [CommandSurface::Slash, CommandSurface::SlashSelection]
    );
    assert_eq!(spec.keybinding.as_deref(), Some("Mod-Alt-r"));
    assert_eq!(spec.scope.reach, CommandReach::Document);
    // Le chiavi dei parametri che la spec dà da sé stanno nel catalogo.
    let catalogs = catalog();
    let locale = Locale::default();
    let strings = Strings::new(&catalogs, "it", &locale);
    assert_eq!(strings.render(&spec.params[0].title), "Selezione");
    assert_eq!(strings.render(&spec.params[1].title), "Nota");
}

#[test]
fn l_impronta_e_della_ricetta_letta_non_del_testo() {
    let base = recipe(&minimal("", ONE_STEP));
    let commented = format!(
        "---\ntag: x\n---\nUn commento in più.\n\n{}",
        minimal("", ONE_STEP).replace("id: prova", "id: prova   # l'identità")
    );
    assert_eq!(fingerprint(&base), fingerprint(&recipe(&commented)));
    let reordered = note(&format!(
        "id: prova\nfub-recipe: 1\ndescription: Una prova.\ntitle: Prova\nsteps:\n{}",
        "  - args:\n      value: \"sì\"\n      key: fatto\n      doc: \"{{doc}}\"\n    run: note.property.set"
    ));
    assert_eq!(fingerprint(&base), fingerprint(&recipe(&reordered)));
    let other = recipe(&minimal("", &ONE_STEP.replace("fatto", "finito")));
    assert_ne!(fingerprint(&base), fingerprint(&other));
    let hex = fingerprint(&base);
    assert_eq!(hex.len(), 64);
    assert!(hex.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn le_righe_contano_anche_il_frontmatter() {
    let source = format!(
        "---\ntag: x\n---\n{}",
        minimal("", "  - run: x.y\n    args:\n      a: \"{{boh}}\"")
    );
    let found = problems(&source);
    assert_eq!(codes(&found), [ProblemCode::SegnapostoSconosciuto]);
    // Frontmatter (3) + titolo, testo, vuote (4) + recinzione (1) + 4 campi +
    // `steps:` + `- run` + `args:` = la riga 16.
    assert_eq!(found[0].line, Some(16), "{found:#?}");
}

#[test]
fn una_mappa_fra_graffe_da_la_riga_della_chiave_che_la_apre() {
    let found = problems(&minimal("", "  - run: x.y\n    args: { a: \"{{boh}}\" }"));
    assert_eq!(found[0].field, "steps[0].args.a");
    assert_eq!(found[0].line, Some(12));
}

#[test]
fn id_ripetuto_occupato_e_troppe() {
    let a = recipe(&minimal("", ONE_STEP));
    let b = recipe(&minimal("", ONE_STEP).replace("title: Prova", "title: Altra"));
    let c = recipe(&minimal("", ONE_STEP).replace("id: prova", "id: terza"));
    let found = check_unique(&[&a, &b, &c]);
    assert_eq!(
        found[0].as_ref().map(|p| p.code),
        Some(ProblemCode::IdRipetuto)
    );
    assert_eq!(found[1].as_ref().map(|p| p.line), Some(Some(7)));
    assert!(found[2].is_none());
    assert_eq!(Problem::occupied_id(&a).code, ProblemCode::IdOccupato);
    let too_many = Problem::too_many();
    assert_eq!((too_many.code, too_many.line), (ProblemCode::Troppe, None));
    assert_eq!(RECIPES_MAX, 200);
}

#[test]
fn ogni_codice_si_scrive_come_nella_pagina() {
    let page = include_str!("../../../docs/reference/ricette.md");
    for code in ProblemCode::ALL {
        let written = serde_json::to_value(code).unwrap();
        assert_eq!(written, Value::from(code.as_str()));
        assert!(
            page.contains(&format!("`{code}`")),
            "la pagina non dice `{code}`"
        );
    }
}

/// La frase di un problema si legge in italiano e in inglese, mai come chiave
/// grezza (che le chiavi ci siano tutte lo prova `recipes/format.rs`).
#[test]
fn la_frase_di_un_problema_parla_la_lingua_dell_interfaccia() {
    let found = problems(&minimal("colore: blu\n", ONE_STEP));
    let catalogs = catalog();
    for (language, expected) in [
        ("it", "«colore» non è un campo delle ricette"),
        ("en", "“colore” is not a recipe field"),
    ] {
        let locale = Locale {
            language: language.to_string(),
            ..Locale::default()
        };
        let said = Strings::new(&catalogs, "it", &locale).render(&found[0].message);
        assert!(said.starts_with(expected), "{language}: {said}");
    }
}

#[test]
fn il_contesto_vero_si_espande_come_quello_dei_template() {
    let ctx = context_at(1_790_000_000_000, &Locale::default()).unwrap();
    let recipe = recipe(&minimal("", "  - run: x.y\n    args: { d: \"{{date}}\" }"));
    let steps = expand(&recipe, &json!({}), &ctx).unwrap();
    assert_eq!(steps[0].1["d"], Value::from(ctx.date.as_str()));
}
