// Senza la cargo feature `base` il modulo non è compilato, e un test che lo
// nomina non avrebbe un soggetto.
#![cfg(feature = "base")]
//! **`base.view.set`, `base.view.add` e `base.view.remove` end-to-end**, attraverso
//! il kernel vero e il formato vero dei `.base`: la modifica arriva nel file
//! com'è stata chiesta e il resto dei byte resta; il piano non scrive; l'annulla
//! riporta i byte di prima; una revisione detta sbagliata, o un piano rimasto
//! indietro, non scrivono sopra un file cambiato; una chiave in flusso e un file
//! che non è una Base si rifiutano senza toccare il disco.

use camino::Utf8PathBuf;
use fub_abi::command::{CommandEffect, CommandOutcome, InvokeMode, UndoStep};
use fub_abi::event::Actor;
use fub_abi::model::DocId;
use fub_abi::PluginError;
use fub_features::base::{BaseCommands, BASE_VIEW_ADD, BASE_VIEW_REMOVE, BASE_VIEW_SET};
use fub_features::BASE_ID;
use fub_format_base::BaseProvider;
use fub_format_markdown::MarkdownProvider;
use fub_kernel::{FormatRegistry, Workspace};
use serde_json::{json, Value};

const BASE_FILE: &str = "Progetti.base";

/// Una Base scritta a mano, con i commenti, un flusso e un'abitudine di spazi
/// che nessuna modifica deve toccare.
const BEFORE: &str = "# Progetti del vault.\nversion: 1\nviews:\n  - name: Tutti   # la tabella\n    type: table\n    order: [file.name]\n  # per stato\n  - name: Stato\n    type: kanban\n";

struct Vault {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
}

impl Vault {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("utf8");
        Vault { _dir: dir, root }
    }

    fn open(&self) -> Workspace {
        let mut registry = FormatRegistry::new();
        registry
            .register(MarkdownProvider::boxed())
            .expect("nessun conflitto di estensioni");
        registry
            .register(BaseProvider::boxed())
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::new(&self.root, registry).expect("l'apertura del vault riesce");
        ws.register_plugin(
            fub_abi::traits::PluginManifest::core(BASE_ID, BASE_ID)
                .speaking("it", fub_features::base::catalog()),
            fub_kernel::Trust::Core,
        )
        .expect("dichiarato");
        ws.register_command_provider(BASE_ID, Box::new(BaseCommands))
            .expect("registrato");
        ws
    }
}

fn with_base(text: &str) -> (Vault, Workspace) {
    // Scritta da fuori, come la trova Fub.
    let vault = Vault::new();
    std::fs::write(vault.root.join(BASE_FILE), text).expect("la Base si scrive");
    std::fs::write(vault.root.join("note.md"), "# Una nota\n").expect("la nota si scrive");
    let mut ws = vault.open();
    ws.reindex().expect("reindex");
    (vault, ws)
}

fn invoke(
    ws: &mut Workspace,
    command: &str,
    args: Value,
    mode: InvokeMode,
) -> Result<CommandOutcome, PluginError> {
    ws.invoke_command(command, args, mode, Actor::User)
}

fn source(ws: &Workspace, id: &str) -> String {
    ws.read_source(&DocId::new(id)).expect("legge")
}

fn revision(ws: &Workspace, id: &str) -> String {
    ws.document_revision(&DocId::new(id)).expect("revisione").0
}

/// Annulla un esito: i passi, come li esegue il kernel.
fn undo(ws: &mut Workspace, outcome: CommandOutcome) {
    let undo = outcome.undo.expect("si annulla");
    for step in undo.steps {
        let UndoStep::Edit(planned) = step else {
            panic!("l'annulla è una modifica al testo");
        };
        ws.apply_edit(&planned.doc, planned.edit)
            .expect("l'annulla si applica");
    }
}

#[test]
fn una_chiave_si_scrive_il_resto_resta_e_l_annulla_riporta_i_byte() {
    let (_vault, mut ws) = with_base(BEFORE);
    let base = revision(&ws, BASE_FILE);

    let outcome = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Stato", "key": "limit", "value": "5", "base": base }),
        InvokeMode::Apply,
    )
    .expect("la chiave si scrive");

    let expected = BEFORE.replace("    type: kanban\n", "    type: kanban\n    limit: 5\n");
    assert_eq!(source(&ws, BASE_FILE), expected, "solo la riga nuova");
    let CommandEffect::Custom { ns, payload } = &outcome.effect else {
        panic!("l'effetto dice la revisione nuova");
    };
    assert_eq!(ns, BASE_ID);
    assert_eq!(payload["revision"], revision(&ws, BASE_FILE));

    undo(&mut ws, outcome);
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "l'annulla riporta i byte di prima"
    );
}

#[test]
fn il_piano_non_scrive_e_applicato_scrive_lo_stesso_testo() {
    let (_vault, mut ws) = with_base(BEFORE);
    let args = json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "9" });

    let plan = invoke(&mut ws, BASE_VIEW_SET, args.clone(), InvokeMode::DryRun).expect("il piano");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "il piano non scrive");
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("un piano");
    };
    assert_eq!(plan.edit_count(), 1);
    let planned = plan.edits[0].clone();
    assert_eq!(planned.doc, DocId::new(BASE_FILE));
    let (expected, _) = planned
        .edit
        .apply_to(BEFORE)
        .expect("il piano sta sul file");

    invoke(&mut ws, BASE_VIEW_SET, args, InvokeMode::Apply).expect("si applica");
    assert_eq!(source(&ws, BASE_FILE), expected, "stesso testo del piano");
}

#[test]
fn una_revisione_detta_diversa_e_in_conflitto_e_non_scrive() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "2", "base": "sha256:0000" }),
        InvokeMode::Apply,
    )
    .expect_err("la revisione non combacia");
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "non ha scritto");
}

#[test]
fn un_piano_rimasto_indietro_non_si_applica_a_un_file_cambiato() {
    let (vault, mut ws) = with_base(BEFORE);
    let plan = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "3" }),
        InvokeMode::DryRun,
    )
    .expect("il piano");
    let CommandEffect::Plan(plan) = plan.effect else {
        panic!("un piano");
    };
    let planned = plan.edits[0].clone();

    // Qualcuno scrive il file mentre il piano aspetta l'approvazione.
    let changed = format!("{BEFORE}# scritto altrove\n");
    std::fs::write(vault.root.join(BASE_FILE), &changed).expect("si scrive");
    ws.reindex().expect("reindex");

    let error = PluginError::from(
        ws.apply_edit(&planned.doc, planned.edit)
            .expect_err("il piano non trova la sua base"),
    );
    assert!(matches!(error, PluginError::Conflict(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), changed, "il file cambiato resta");
}

#[test]
fn una_vista_si_aggiunge_e_si_toglie_e_ciascun_passo_si_annulla() {
    let (_vault, mut ws) = with_base(BEFORE);

    let added = invoke(
        &mut ws,
        BASE_VIEW_ADD,
        json!({ "doc": BASE_FILE, "name": "Liste", "type": "list" }),
        InvokeMode::Apply,
    )
    .expect("la vista si aggiunge");
    let with_view = source(&ws, BASE_FILE);
    assert!(
        with_view.ends_with("  - name: Liste\n    type: list\n"),
        "{with_view}"
    );

    let removed = invoke(
        &mut ws,
        BASE_VIEW_REMOVE,
        json!({ "doc": BASE_FILE, "view": "Liste" }),
        InvokeMode::Apply,
    )
    .expect("la vista si toglie");
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "togliere la vista nuova riporta il file"
    );

    undo(&mut ws, removed);
    assert_eq!(source(&ws, BASE_FILE), with_view, "l'annulla ridà la vista");
    undo(&mut ws, added);
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "l'annulla ridà il file di prima"
    );
}

/// #97 sul `.base`: un file con BOM, CRLF o tutti e due si modifica dalla
/// barra, e i byte sul disco tengono il BOM in testa e i terminatori del file.
/// L'annulla riporta i byte di prima. `views:` sta sulla prima riga, subito
/// dopo il BOM: è la riga che la toppa deve riconoscere.
#[test]
fn bom_e_crlf_restano_sul_disco_dopo_una_modifica_e_l_annulla() {
    const PLAIN: &str =
        "views:\n  - name: Tutti   # la tabella\n    type: table\n  - name: Stato\n    type: kanban\n";
    for (name, bom, eol) in [
        ("CRLF", "", "\r\n"),
        ("BOM", "\u{feff}", "\n"),
        ("BOM+CRLF", "\u{feff}", "\r\n"),
    ] {
        let before = format!("{bom}{}", PLAIN.replace('\n', eol));
        let (vault, mut ws) = with_base(&before);
        let on_disk = || std::fs::read(vault.root.join(BASE_FILE)).expect("si legge dal disco");

        let set = invoke(
            &mut ws,
            BASE_VIEW_SET,
            json!({ "doc": BASE_FILE, "view": "Stato", "key": "limit", "value": "5" }),
            InvokeMode::Apply,
        )
        .unwrap_or_else(|error| panic!("{name}: la chiave si scrive: {error:?}"));
        let expected = format!("{before}    limit: 5{eol}");
        assert_eq!(on_disk(), expected.as_bytes(), "{name}: la chiave nuova");

        let added = invoke(
            &mut ws,
            BASE_VIEW_ADD,
            json!({ "doc": BASE_FILE, "name": "Liste", "type": "list" }),
            InvokeMode::Apply,
        )
        .unwrap_or_else(|error| panic!("{name}: la vista si aggiunge: {error:?}"));
        let expected = format!("{expected}  - name: Liste{eol}    type: list{eol}");
        assert_eq!(on_disk(), expected.as_bytes(), "{name}: la vista nuova");

        undo(&mut ws, added);
        undo(&mut ws, set);
        assert_eq!(
            on_disk(),
            before.as_bytes(),
            "{name}: l'annulla ridà i byte"
        );
    }
}

/// Un calendario si aggiunge nella forma di ripiego (`type: table` con
/// `fub.view`), la sua data si scrive dentro `fub:`, e ogni passo si annulla.
#[test]
fn un_calendario_si_aggiunge_con_la_data_in_fub_e_ogni_passo_si_annulla() {
    let (_vault, mut ws) = with_base(BEFORE);
    let added = invoke(
        &mut ws,
        BASE_VIEW_ADD,
        json!({ "doc": BASE_FILE, "name": "Agenda", "type": "calendar" }),
        InvokeMode::Apply,
    )
    .expect("il calendario si aggiunge");
    let with_view = source(&ws, BASE_FILE);
    assert!(
        with_view.ends_with("  - name: Agenda\n    type: table\n    fub:\n      view: calendar\n"),
        "{with_view}"
    );

    let dated = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Agenda", "key": "date", "value": "\"scadenza\"" }),
        InvokeMode::Apply,
    )
    .expect("la data si scrive");
    assert!(
        source(&ws, BASE_FILE).ends_with("    fub:\n      view: calendar\n      date: scadenza\n"),
        "{}",
        source(&ws, BASE_FILE)
    );

    undo(&mut ws, dated);
    assert_eq!(
        source(&ws, BASE_FILE),
        with_view,
        "l'annulla ridà il calendario senza data"
    );
    undo(&mut ws, added);
    assert_eq!(
        source(&ws, BASE_FILE),
        BEFORE,
        "l'annulla ridà il file di prima"
    );
}

/// La data non si scrive in una vista che non è un calendario, e il file resta.
#[test]
fn una_data_in_una_vista_che_non_e_calendario_si_rifiuta() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Stato", "key": "date", "value": "\"scadenza\"" }),
        InvokeMode::Apply,
    )
    .expect_err("date non va in una bacheca");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "non ha scritto");
}

#[test]
fn una_chiave_in_flusso_si_rifiuta_e_il_file_resta() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "order" }),
        InvokeMode::Apply,
    )
    .expect_err("order è in YAML di flusso");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(source(&ws, BASE_FILE), BEFORE, "non ha scritto");
}

#[test]
fn un_valore_null_toglie_la_chiave() {
    let before = "views:\n  - name: Tutti\n    type: table\n    limit: 9\n";
    let (_vault, mut ws) = with_base(before);
    invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "limit", "value": "null" }),
        InvokeMode::Apply,
    )
    .expect("la chiave si toglie");
    assert_eq!(
        source(&ws, BASE_FILE),
        "views:\n  - name: Tutti\n    type: table\n"
    );
}

#[test]
fn un_documento_che_non_e_una_base_non_si_scrive() {
    let (_vault, mut ws) = with_base(BEFORE);
    let error = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": "note.md", "view": "Tutti", "key": "limit", "value": "2" }),
        InvokeMode::Apply,
    )
    .expect_err("una nota non è una Base");
    assert!(matches!(error, PluginError::BadArgs(_)), "{error:?}");
    assert_eq!(source(&ws, "note.md"), "# Una nota\n", "la nota è com'era");
}

#[test]
fn una_chiave_gia_com_e_non_scrive_e_non_annulla_niente() {
    let (_vault, mut ws) = with_base(BEFORE);
    let outcome = invoke(
        &mut ws,
        BASE_VIEW_SET,
        json!({ "doc": BASE_FILE, "view": "Tutti", "key": "type", "value": "\"table\"" }),
        InvokeMode::Apply,
    )
    .expect("niente da cambiare non è un errore");
    assert!(outcome.undo.is_none(), "niente da annullare");
    assert_eq!(source(&ws, BASE_FILE), BEFORE);
}

// I gesti della barra della Base (T15): ognuno manda una sola chiave, con il
// valore nella forma che il client costruisce (`apps/client/src/editors/base/
// filter.ts` e `sort.ts`). Qui si vede quali righe quel valore scrive, e che il
// piano lo rilegge uguale.

/// Una Base con la vista dei gesti in YAML a blocchi, e un'altra che nessun
/// gesto tocca.
const GESTI: &str = "# Opere in prestito.\nviews:\n  - name: Tabella   # la vista dei gesti\n    type: table\n  - name: Bacheca\n    type: kanban\n";

/// Scrive `key` della vista Tabella con `value` (JSON, o niente per toglierla),
/// con la revisione del file, e torna il testo nuovo.
fn gesto(ws: &mut Workspace, key: &str, value: Option<Value>) -> String {
    let base = revision(ws, BASE_FILE);
    let mut args = json!({ "doc": BASE_FILE, "view": "Tabella", "key": key, "base": base });
    if let Some(value) = value {
        args["value"] = Value::String(value.to_string());
    }
    invoke(ws, BASE_VIEW_SET, args, InvokeMode::Apply).expect("il gesto si scrive");
    source(ws, BASE_FILE)
}

/// Le righe che stanno fra la vista dei gesti e quella accanto.
fn con(righe: &str) -> String {
    GESTI.replace("    type: table\n", &format!("    type: table\n{righe}"))
}

#[test]
fn il_filtro_composto_a_vista_scrive_solo_filters() {
    let (_vault, mut ws) = with_base(GESTI);
    let filtro = json!({ "and": [
        { "condition": { "property": "stato", "op": "is", "value": "Arrivata" } },
        { "condition": { "property": "valore", "op": "greater_than", "value": 3000 } },
    ] });
    assert_eq!(
        gesto(&mut ws, "filters", Some(filtro)),
        con("    filters:\n      and:\n      - condition:\n          property: stato\n          op: is\n          value: Arrivata\n      - condition:\n          property: valore\n          op: greater_than\n          value: 3000\n"),
        "solo la chiave filters; commenti e vista accanto restano",
    );
}

#[test]
fn il_filtro_come_ricerca_scrive_l_oppure_e_l_ultima_etichetta_lo_toglie() {
    let (_vault, mut ws) = with_base(GESTI);
    let filtro = json!({ "or": [
        { "condition": { "property": "stato", "op": "contains", "value": "Arrivata" } },
        { "not": { "condition": { "file": "path", "op": "in_folder", "value": "Archivio" } } },
    ] });
    assert_eq!(
        gesto(&mut ws, "filters", Some(filtro)),
        con("    filters:\n      or:\n      - condition:\n          property: stato\n          op: contains\n          value: Arrivata\n      - not:\n          condition:\n            file: path\n            op: in_folder\n            value: Archivio\n"),
    );
    assert_eq!(
        gesto(&mut ws, "filters", None),
        GESTI,
        "togliere l'ultima etichetta riporta i byte di prima"
    );
}

#[test]
fn ordina_e_proprieta_scrivono_sort_e_order_e_basta() {
    let (_vault, mut ws) = with_base(GESTI);
    let sort = "    sort:\n      - key: consegna\n        descending: true\n";
    assert_eq!(
        gesto(
            &mut ws,
            "sort",
            Some(json!([{ "key": "consegna", "descending": true }]))
        ),
        con(sort),
    );
    assert_eq!(
        gesto(
            &mut ws,
            "order",
            Some(json!(["file.name", "stato", "consegna"]))
        ),
        con(&format!(
            "    order:\n      - file.name\n      - stato\n      - consegna\n{sort}"
        )),
        "le colonne entrano senza toccare l'ordinamento",
    );
    assert_eq!(
        gesto(
            &mut ws,
            "order",
            Some(json!(["stato", "file.name", "consegna"]))
        ),
        con(&format!(
            "    order:\n      - stato\n      - file.name\n      - consegna\n{sort}"
        )),
        "trascinare una colonna riscrive soltanto order",
    );
    assert_eq!(gesto(&mut ws, "order", None), con(sort));
}

/// Le righe che la vista Tabella del file lascia, su due opere con una data,
/// un numero e uno stato per nota.
fn righe(source: &str) -> Vec<String> {
    use fub_abi::{IndexProvider, IndexQuery};
    let date =
        |m: u8, d: u8| json!({"kind":"date","value":{"year":2026,"month":m,"day":d,"time":null}});
    let query = json!({"version":1,"op":"derive","source":source,"view":"Tabella","now_ms":0,"container":null,"rows":[
        {"doc":"Opere/A.md","props":{"consegna":date(2,24),"valore":{"kind":"number","value":2600.0},"stato":{"kind":"text","value":"Arrivata"}}},
        {"doc":"Opere/B.md","props":{"consegna":date(3,18),"valore":{"kind":"number","value":7300.5},"stato":{"kind":"text","value":"In viaggio"}}}
    ]});
    let answer = fub_features::BaseIndex::new()
        .query(IndexQuery::Custom {
            ns: "fub.base".into(),
            query,
        })
        .expect("la vista si deriva");
    let answer = serde_json::to_value(answer).expect("json");
    let rows = answer
        .pointer("/value/rows")
        .or(answer.pointer("/rows"))
        .and_then(Value::as_array)
        .expect("righe");
    rows.iter()
        .map(|row| row["doc"].as_str().expect("doc").to_owned())
        .collect()
}

#[test]
fn un_filtro_su_una_data_e_su_un_numero_scritto_dalla_barra_trova_le_righe() {
    let (_vault, mut ws) = with_base(GESTI);
    // La barra scrive la data nella forma ISO e il numero come numero.
    let scritto = gesto(
        &mut ws,
        "filters",
        Some(
            json!({ "condition": { "property": "consegna", "op": "greater_than", "value": "2026-03-01" } }),
        ),
    );
    assert_eq!(
        scritto,
        con("    filters:\n      condition:\n        property: consegna\n        op: greater_than\n        value: 2026-03-01\n")
    );
    assert_eq!(righe(&scritto), ["Opere/B.md"]);
    let scritto = gesto(
        &mut ws,
        "filters",
        Some(json!({ "condition": { "property": "consegna", "op": "is", "value": "2026-03-18" } })),
    );
    assert_eq!(righe(&scritto), ["Opere/B.md"]);
    let scritto = gesto(
        &mut ws,
        "filters",
        Some(
            json!({ "condition": { "property": "valore", "op": "greater_than", "value": 3000.5 } }),
        ),
    );
    assert_eq!(
        scritto,
        con("    filters:\n      condition:\n        property: valore\n        op: greater_than\n        value: 3000.5\n")
    );
    assert_eq!(righe(&scritto), ["Opere/B.md"]);
    // Un file scritto a mano col numero fra virgolette trova lo stesso.
    assert_eq!(
        righe(&con(
            "    filters:\n      condition: {property: valore, op: greater_than, value: '3000'}\n"
        )),
        ["Opere/B.md"]
    );
    let scritto = gesto(
        &mut ws,
        "filters",
        Some(json!({ "condition": { "property": "stato", "op": "contains", "value": "VIAGGIO" } })),
    );
    assert_eq!(
        righe(&scritto),
        ["Opere/B.md"],
        "contiene non distingue le maiuscole"
    );
}

/// Il campo «Documento» si compila anche a mano (#486): «progetti» è la sola
/// Base con quel nome, e la nota omonima non la rende ambigua perché i comandi
/// delle viste vogliono un `.base`.
#[test]
fn a_base_written_by_name_is_the_one_the_command_changes() {
    let (_vault, mut ws) = with_base(BEFORE);
    std::fs::write(_vault.root.join("Progetti.md"), "# Omonima\n").expect("la nota si scrive");
    ws.reindex().expect("reindex");
    invoke(
        &mut ws,
        BASE_VIEW_ADD,
        json!({ "doc": "progetti", "name": "Liste", "type": "list" }),
        InvokeMode::Apply,
    )
    .expect("il nome nomina la sola Base");
    assert!(
        source(&ws, BASE_FILE).ends_with("  - name: Liste\n    type: list\n"),
        "{}",
        source(&ws, BASE_FILE)
    );

    let missing = invoke(
        &mut ws,
        BASE_VIEW_ADD,
        json!({ "doc": "Clienti", "name": "Liste" }),
        InvokeMode::Apply,
    )
    .expect_err("nessuna Base si chiama così");
    let PluginError::BadArgs(text) = missing else {
        panic!("atteso BadArgs, arrivato {missing:?}")
    };
    assert_eq!(
        text,
        "Nessun documento che questo comando può usare si chiama «Clienti». Sceglilo \
         dall'elenco del campo."
    );
}
