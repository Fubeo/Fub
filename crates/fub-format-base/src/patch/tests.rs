//! I casi di [`apply`] che il corpus non copre riga per riga: ogni rifiuto, i
//! limiti, le fini di riga e l'ordine in cui nascono le chiavi nuove.

use super::*;
use serde_json::json;

/// Applica la toppa e restituisce il file che ne esce, come lo scrive l'host.
fn edited(source: &str, change: &BaseChange) -> String {
    let edits = apply(source, change).expect("la toppa si applica");
    let request = EditRequest::new(Revision::of(source), edits);
    request
        .apply_to(source)
        .expect("le modifiche stanno sul file")
        .0
}

fn set(view: &str, key: ViewKey, value: Value) -> BaseChange {
    BaseChange::SetKey {
        view: view.into(),
        key,
        value: Some(value),
    }
}

fn unset(view: &str, key: ViewKey) -> BaseChange {
    BaseChange::SetKey {
        view: view.into(),
        key,
        value: None,
    }
}

fn refused(source: &str, change: &BaseChange) -> PatchError {
    apply(source, change).expect_err("la toppa deve rifiutare")
}

#[test]
fn un_valore_scalare_cambia_la_sua_riga_e_il_commento_resta() {
    let source = "version: 1\nviews:\n  - name: Tutte\n    type: table\n    limit: 5  # tetto\n";
    let out = edited(source, &set("Tutte", ViewKey::Limit, json!(7)));
    assert_eq!(
        out,
        "version: 1\nviews:\n  - name: Tutte\n    type: table\n    limit: 7  # tetto\n"
    );
}

#[test]
fn un_blocco_si_riscrive_e_il_commento_della_chiave_resta() {
    let source = "views:\n  - name: Tutte\n    type: table\n    sort:  # ordine\n      - key: prop.a\n        descending: false\n    limit: 9\n";
    let out = edited(
        source,
        &set(
            "Tutte",
            ViewKey::Sort,
            json!([{ "key": "prop.b", "descending": true }]),
        ),
    );
    assert_eq!(
        out,
        "views:\n  - name: Tutte\n    type: table\n    sort:  # ordine\n      - key: prop.b\n        descending: true\n    limit: 9\n"
    );
}

#[test]
fn una_chiave_nuova_va_al_suo_posto_fra_le_altre() {
    let source = "views:\n  - name: Tutte\n    type: table\n    group:\n      key: prop.status\n";
    let out = edited(
        source,
        &set(
            "Tutte",
            ViewKey::Sort,
            json!([{ "key": "prop.status", "descending": true }]),
        ),
    );
    assert_eq!(
        out,
        "views:\n  - name: Tutte\n    type: table\n    sort:\n      - key: prop.status\n        descending: true\n    group:\n      key: prop.status\n"
    );
}

#[test]
fn un_commento_attaccato_alla_chiave_successiva_resta_con_lei() {
    let source = "views:\n  - name: Tutte\n    type: table\n    # ordinamento per data\n    sort:\n      - key: prop.d\n";
    let out = edited(source, &set("Tutte", ViewKey::Order, json!(["file.name"])));
    assert_eq!(
        out,
        "views:\n  - name: Tutte\n    type: table\n    order:\n      - file.name\n    # ordinamento per data\n    sort:\n      - key: prop.d\n"
    );
}

#[test]
fn togliere_una_chiave_assente_o_il_suo_stesso_valore_non_scrive() {
    let source = "views:\n  - name: Tutte\n    type: table\n";
    assert!(apply(source, &unset("Tutte", ViewKey::Group))
        .expect("nessun errore")
        .is_empty());
    assert!(apply(source, &set("Tutte", ViewKey::Type, json!("table")))
        .expect("nessun errore")
        .is_empty());
}

#[test]
fn togliere_una_chiave_toglie_le_sue_righe() {
    let source =
        "views:\n  - name: Tutte\n    type: table\n    sort:\n      - key: prop.a\n    limit: 4\n";
    let out = edited(source, &unset("Tutte", ViewKey::Sort));
    assert_eq!(
        out,
        "views:\n  - name: Tutte\n    type: table\n    limit: 4\n"
    );
}

#[test]
fn un_null_toglie_la_chiave_come_manca() {
    let source = "views:\n  - name: Tutte\n    type: table\n    limit: 4\n";
    let out = edited(source, &set("Tutte", ViewKey::Limit, Value::Null));
    assert_eq!(out, "views:\n  - name: Tutte\n    type: table\n");
}

#[test]
fn il_filtro_scritto_come_parola_diventa_un_albero() {
    let source = "filters: all\nviews:\n  - name: Tutte\n    type: table\n";
    let out = edited(
        source,
        &set(
            "Tutte",
            ViewKey::Filters,
            json!({ "and": [{ "condition": { "property": "status", "op": "is", "value": "Arrivata" } }] }),
        ),
    );
    assert_eq!(
        out,
        "filters: all\nviews:\n  - name: Tutte\n    type: table\n    filters:\n      and:\n      - condition:\n          property: status\n          op: is\n          value: Arrivata\n"
    );
    let read = crate::model::BaseDefinition::parse(&out).expect("si rilegge");
    assert!(matches!(read.views[0].filters, FilterDef::And(_)));
}

#[test]
fn un_albero_and_or_si_sostituisce_per_intero() {
    let source = "views:\n  - name: Tutte\n    type: table\n    filters:\n      or:\n        - condition: {property: a, op: is, value: 1}\n        - condition: {property: a, op: is, value: 2}\n    limit: 2\n";
    let out = edited(
        source,
        &set(
            "Tutte",
            ViewKey::Filters,
            json!({ "not": { "condition": { "property": "a", "op": "is", "value": 3 } } }),
        ),
    );
    assert!(out.contains("    limit: 2\n"), "{out}");
    assert!(!out.contains("value: 2"), "{out}");
    let read = crate::model::BaseDefinition::parse(&out).expect("si rilegge");
    assert!(matches!(read.views[0].filters, FilterDef::Not(_)));
}

#[test]
fn una_vista_si_aggiunge_in_fondo_e_i_commenti_fra_le_viste_restano() {
    let source = "# base dei progetti\nviews:\n  # la prima\n  - name: Tutte\n    type: table\n\n  # la seconda\n  - name: Liste\n    type: list\n";
    let out = edited(
        source,
        &BaseChange::AddView {
            name: "Stato".into(),
            view_type: ViewType::Kanban,
        },
    );
    assert_eq!(
        out,
        "# base dei progetti\nviews:\n  # la prima\n  - name: Tutte\n    type: table\n\n  # la seconda\n  - name: Liste\n    type: list\n  - name: Stato\n    type: kanban\n"
    );
}

#[test]
fn senza_chiave_views_la_vista_nasce_in_fondo_al_file() {
    let source = "version: 1\nfilters: all\n";
    let out = edited(
        source,
        &BaseChange::AddView {
            name: "Tutte".into(),
            view_type: ViewType::Table,
        },
    );
    assert_eq!(
        out,
        "version: 1\nfilters: all\nviews:\n  - name: Tutte\n    type: table\n"
    );
}

#[test]
fn views_vuote_si_riempiono_e_il_commento_della_chiave_resta() {
    let source = "views: []  # ancora nessuna\n";
    let out = edited(
        source,
        &BaseChange::AddView {
            name: "Tutte".into(),
            view_type: ViewType::Table,
        },
    );
    assert_eq!(
        out,
        "views:  # ancora nessuna\n  - name: Tutte\n    type: table\n"
    );
}

#[test]
fn togliere_una_vista_in_mezzo_lascia_i_commenti_intorno() {
    let source = "views:\n  - name: A\n    type: table\n  # tra A e B\n  - name: B\n    type: list\n  - name: C\n    type: table\n";
    let out = edited(source, &BaseChange::RemoveView { view: "B".into() });
    assert_eq!(
        out,
        "views:\n  - name: A\n    type: table\n  # tra A e B\n  - name: C\n    type: table\n"
    );
}

#[test]
fn togliere_l_ultima_vista_lascia_una_lista_vuota_che_si_rilegge() {
    let source = "filters: all\nviews:  # solo questa\n  - name: A\n    type: table\nversion: 1\n";
    let out = edited(source, &BaseChange::RemoveView { view: "A".into() });
    assert_eq!(out, "filters: all\nviews: []  # solo questa\nversion: 1\n");
    let read = crate::model::BaseDefinition::parse(&out).expect("si rilegge");
    assert!(read.views.is_empty());
}

#[test]
fn le_fini_di_riga_restano_quelle_del_file() {
    let source = "views:\r\n  - name: Tutte\r\n    type: table\r\n";
    let out = edited(
        source,
        &BaseChange::AddView {
            name: "Liste".into(),
            view_type: ViewType::List,
        },
    );
    assert_eq!(
        out,
        "views:\r\n  - name: Tutte\r\n    type: table\r\n  - name: Liste\r\n    type: list\r\n"
    );
    let out = edited(source, &set("Tutte", ViewKey::Limit, json!(2)));
    assert_eq!(
        out,
        "views:\r\n  - name: Tutte\r\n    type: table\r\n    limit: 2\r\n"
    );
}

#[test]
fn un_file_che_finisce_senza_a_capo_non_ne_guadagna_uno_fuori_posto() {
    let source = "views:\n  - name: Tutte\n    type: table";
    let out = edited(source, &set("Tutte", ViewKey::Limit, json!(2)));
    assert_eq!(
        out,
        "views:\n  - name: Tutte\n    type: table\n    limit: 2"
    );
}

#[test]
fn una_chiave_fra_virgolette_tiene_le_sue_virgolette() {
    let source = "views:\n  - \"name\": 'Tutte'\n    \"type\": table\n    \"limit\": 4\n";
    let out = edited(source, &set("Tutte", ViewKey::Limit, json!(8)));
    assert_eq!(
        out,
        "views:\n  - \"name\": 'Tutte'\n    \"type\": table\n    \"limit\": 8\n"
    );
}

#[test]
fn il_nome_con_due_punti_si_scrive_virgolettato_e_si_rilegge() {
    let source = "views:\n  - name: Tutte\n    type: table\n";
    let out = edited(source, &set("Tutte", ViewKey::Name, json!("Note: 2026")));
    let read = crate::model::BaseDefinition::parse(&out).expect("si rilegge");
    assert_eq!(read.views[0].name, "Note: 2026");
}

#[test]
fn la_chiave_obbligatoria_non_si_toglie() {
    let source = "views:\n  - name: Tutte\n    type: table\n";
    assert!(matches!(
        refused(source, &unset("Tutte", ViewKey::Type)),
        PatchError::RequiredKey(ViewKey::Type)
    ));
    assert!(matches!(
        refused(source, &unset("Tutte", ViewKey::Name)),
        PatchError::RequiredKey(ViewKey::Name)
    ));
}

#[test]
fn una_vista_che_non_c_e_o_un_nome_gia_preso_si_rifiutano() {
    let source = "views:\n  - name: Tutte\n    type: table\n  - name: Liste\n    type: list\n";
    assert!(matches!(
        refused(source, &set("Manca", ViewKey::Limit, json!(1))),
        PatchError::NoView(name) if name == "Manca"
    ));
    assert!(matches!(
        refused(source, &set("Tutte", ViewKey::Name, json!("Liste"))),
        PatchError::DuplicateView(name) if name == "Liste"
    ));
    assert!(matches!(
        refused(
            source,
            &BaseChange::AddView {
                name: "Tutte".into(),
                view_type: ViewType::Table,
            }
        ),
        PatchError::DuplicateView(_)
    ));
}

#[test]
fn un_valore_che_il_modello_non_accetta_si_rifiuta_senza_scrivere() {
    let source = "views:\n  - name: Tutte\n    type: table\n";
    assert!(matches!(
        refused(source, &set("Tutte", ViewKey::Limit, json!(0))),
        PatchError::Model(BaseError::Invalid(_))
    ));
    assert!(matches!(
        refused(source, &set("Tutte", ViewKey::Limit, json!("molte"))),
        PatchError::BadValue(ViewKey::Limit)
    ));
    assert!(matches!(
        refused(source, &set("Tutte", ViewKey::Name, json!("a\nb"))),
        PatchError::BadValue(ViewKey::Name)
    ));
    assert!(matches!(
        refused(source, &set("Tutte", ViewKey::Type, json!("grafico"))),
        PatchError::BadValue(ViewKey::Type)
    ));
}

#[test]
fn una_chiave_di_flusso_sulla_chiave_toccata_si_rifiuta() {
    let source = "views:\n  - name: Tutte\n    type: table\n    order: [file.name, prop.a]\n";
    assert!(matches!(
        refused(source, &set("Tutte", ViewKey::Order, json!(["file.name"]))),
        PatchError::Flow {
            place: Place::Key(ViewKey::Order)
        }
    ));
    assert!(matches!(
        refused(source, &unset("Tutte", ViewKey::Order)),
        PatchError::Flow {
            place: Place::Key(ViewKey::Order)
        }
    ));
}

#[test]
fn una_vista_in_flusso_si_rifiuta_ma_le_altre_viste_restano_toccabili() {
    let source = "views:\n  - {name: A, type: table}\n  - name: B\n    type: list\n";
    assert!(matches!(
        refused(source, &set("A", ViewKey::Limit, json!(2))),
        PatchError::Flow { place: Place::View }
    ));
    let out = edited(source, &set("B", ViewKey::Limit, json!(2)));
    assert_eq!(
        out,
        "views:\n  - {name: A, type: table}\n  - name: B\n    type: list\n    limit: 2\n"
    );
}

#[test]
fn un_flusso_su_un_altra_chiave_della_stessa_vista_non_blocca() {
    let source = "views:\n  - name: A\n    type: table\n    order: [file.name]\n    limit: 1\n";
    let out = edited(source, &set("A", ViewKey::Limit, json!(2)));
    assert_eq!(
        out,
        "views:\n  - name: A\n    type: table\n    order: [file.name]\n    limit: 2\n"
    );
}

#[test]
fn ancore_alias_etichette_e_tabulazioni_non_si_toccano() {
    let anchor = "views:\n  - name: A\n    type: table\n    order: &o [file.name]\n  - name: B\n    type: list\n    order: *o\n";
    assert!(matches!(
        refused(anchor, &set("A", ViewKey::Limit, json!(2))),
        PatchError::Unsafe {
            construct: Construct::Anchor,
            ..
        }
    ));
    let tag = "views:\n  - name: A\n    type: table\n    limit: !!int 3\n";
    assert!(matches!(
        refused(tag, &set("A", ViewKey::Search, json!("x"))),
        PatchError::Unsafe {
            construct: Construct::Tag,
            ..
        }
    ));
    let tab = "views:\n  - name: A\n\ttype: table\n";
    assert!(matches!(
        refused(tab, &set("A", ViewKey::Limit, json!(2))),
        PatchError::Unsafe {
            construct: Construct::Tab,
            ..
        }
    ));
}

#[test]
fn un_asterisco_dentro_una_formula_non_e_un_alias() {
    let source = "formulas:\n  - name: doppio\n    expression: prop.a * 2\nviews:\n  - name: A\n    type: table\n";
    let out = edited(source, &set("A", ViewKey::Limit, json!(2)));
    assert!(out.ends_with("    limit: 2\n"), "{out}");
}

#[test]
fn piu_documenti_o_direttive_si_rifiutano() {
    let source = "views:\n  - name: A\n    type: table\n---\nversion: 1\n";
    assert!(matches!(
        refused(source, &set("A", ViewKey::Limit, json!(2))),
        PatchError::Unsafe {
            construct: Construct::Documents,
            ..
        }
    ));
    let directive = "%YAML 1.2\n---\nviews:\n  - name: A\n    type: table\n";
    assert!(matches!(
        refused(directive, &set("A", ViewKey::Limit, json!(2))),
        PatchError::Unsafe {
            construct: Construct::Directive,
            ..
        }
    ));
}

#[test]
fn un_file_illeggibile_non_si_tocca() {
    for source in [
        "filters: [non chiuso\n",
        "version: 2\nviews:\n  - name: A\n    type: table\n",
        "views:\n  - type: table\n",
        "",
    ] {
        assert!(
            matches!(
                refused(source, &set("A", ViewKey::Limit, json!(2))),
                PatchError::Unreadable
            ),
            "{source:?}"
        );
    }
}

#[test]
fn il_limite_del_sorgente_e_del_risultato_si_rifiutano() {
    let big = format!(
        "# {}\nviews:\n  - name: A\n    type: table\n",
        "x".repeat(crate::model::MAX_BASE_SOURCE_BYTES)
    );
    assert!(matches!(
        refused(&big, &set("A", ViewKey::Limit, json!(2))),
        PatchError::Model(BaseError::Limit { .. })
    ));
    let mut full = String::from("views:\n");
    for index in 0..crate::model::MAX_VIEWS {
        full.push_str(&format!("  - name: V{index}\n    type: table\n"));
    }
    assert!(matches!(
        refused(
            &full,
            &BaseChange::AddView {
                name: "Oltre".into(),
                view_type: ViewType::Table,
            }
        ),
        PatchError::Model(BaseError::Limit { what: "views", .. })
    ));
}

#[test]
fn una_vista_senza_chiavi_o_un_file_con_chiavi_ripetute_non_si_tocca() {
    let repeated = "views:\n  - name: A\n    type: table\n    limit: 1\n    limit: 2\n";
    assert!(matches!(
        refused(repeated, &set("A", ViewKey::Search, json!("x"))),
        PatchError::Unreadable | PatchError::Unsafe { .. }
    ));
}

#[test]
fn le_chiavi_sconosciute_della_vista_restano_com_erano() {
    let source = "views:\n  - name: A\n    type: table\n    colore_mio: blu\n";
    let out = edited(source, &set("A", ViewKey::Limit, json!(2)));
    assert_eq!(
        out,
        "views:\n  - name: A\n    type: table\n    colore_mio: blu\n    limit: 2\n"
    );
}

/// La data nasce in un blocco `fub:` in fondo alla vista, e togliendola il
/// blocco sparisce: il file torna com'era, byte per byte.
#[test]
fn la_data_nasce_in_un_blocco_fub_e_togliendola_il_blocco_sparisce() {
    let source = "views:\n  - name: C\n    type: calendar\n    limit: 5\n";
    let dated = edited(source, &set("C", ViewKey::Date, json!("due")));
    assert_eq!(
        dated,
        "views:\n  - name: C\n    type: calendar\n    limit: 5\n    fub:\n      date: due\n"
    );
    assert_eq!(edited(&dated, &unset("C", ViewKey::Date)), source);
}

/// Cambiare il tipo mette `fub:` subito dopo `type`, prima delle altre chiavi
/// della vista, come lo scrive la forma di ripiego.
#[test]
fn il_blocco_fub_nasce_dopo_il_tipo_e_prima_delle_altre_chiavi() {
    let source = "views:\n  - name: C\n    type: cards\n    limit: 5\n";
    let out = edited(source, &set("C", ViewKey::Type, json!("timeline")));
    assert_eq!(
        out,
        "views:\n  - name: C\n    type: table\n    fub:\n      view: timeline\n    limit: 5\n"
    );
}

/// Un blocco `fub:` scritto in flusso non si riscrive: la chiave data lo dice.
#[test]
fn un_blocco_fub_in_flusso_si_rifiuta_senza_scrivere() {
    let source = "views:\n  - name: C\n    type: table\n    fub: {view: calendar, date: due}\n";
    assert!(matches!(
        refused(source, &set("C", ViewKey::Date, json!("altra"))),
        PatchError::Flow {
            place: Place::Key(ViewKey::Date)
        }
    ));
}

/// Cambiare il tipo sull'ultima riga di un file senza a capo: il blocco
/// `fub:` si aggiunge in fondo, e il file resta senza a capo finale.
#[test]
fn cambiare_tipo_sull_ultima_riga_senza_a_capo_non_corrompe_il_file() {
    let source = "views:\n  - name: C\n    type: cards";
    let out = edited(source, &set("C", ViewKey::Type, json!("calendar")));
    assert_eq!(
        out,
        "views:\n  - name: C\n    type: table\n    fub:\n      view: calendar"
    );
}
