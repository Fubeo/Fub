//! Il corpus delle toppe del `.base`: un file com'è, una modifica, il file dopo
//! atteso **byte per byte**. Ogni caso riletto dal modello dà la definizione
//! attesa, e le righe di commento del file restano le stesse e nello stesso
//! ordine. I file sono scritti per la prova, non copiati da vault veri.

use fub_abi::edit::{EditRequest, Revision};
use fub_format_base::model::{BaseDefinition, FilterDef};
use fub_format_base::patch::{apply, BaseChange, Construct, PatchError, Place, ViewKey};
use fub_format_base::ViewType;
use serde_json::json;

/// Il file che esce dalla toppa, come lo scrive l'host: le modifiche applicate
/// alla revisione del file di prima.
fn written(before: &str, change: &BaseChange) -> String {
    let edits = apply(before, change).expect("la toppa si applica");
    EditRequest::new(Revision::of(before), edits)
        .apply_to(before)
        .expect("le modifiche stanno sul file")
        .0
}

fn comments(text: &str) -> Vec<&str> {
    text.lines()
        .filter(|line| line.trim_start().starts_with('#'))
        .collect()
}

fn set(view: &str, key: ViewKey, value: serde_json::Value) -> BaseChange {
    BaseChange::SetKey {
        view: view.into(),
        key,
        value: Some(value),
    }
}

#[test]
fn una_vista_si_ordina_e_la_chiave_nuova_va_prima_del_raggruppamento() {
    let before = include_str!("fixtures/progetti.before.base");
    let after = include_str!("fixtures/progetti.ordina.after.base");
    let change = set(
        "Per stato",
        ViewKey::Sort,
        json!([{ "key": "prop.stato", "descending": false }]),
    );
    let out = written(before, &change);
    assert_eq!(out, after);
    assert_eq!(comments(&out), comments(before));
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert_eq!(read.views[1].name, "Per stato");
    assert_eq!(read.views[1].sort[0].key, "prop.stato");
    assert!(!read.views[1].sort[0].descending);
    assert_eq!(read.views[0].order, ["file.name", "prop.stato"]);
}

#[test]
fn un_filtro_nuovo_va_fra_le_colonne_e_il_limite_e_il_commento_restano() {
    let before = include_str!("fixtures/progetti.before.base");
    let after = include_str!("fixtures/progetti.filtro.after.base");
    let change = set(
        "Tutti",
        ViewKey::Filters,
        json!({ "condition": { "property": "stato", "op": "is_not", "value": "chiuso" } }),
    );
    let out = written(before, &change);
    assert_eq!(out, after);
    assert_eq!(comments(&out), comments(before));
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert!(matches!(read.views[0].filters, FilterDef::Condition { .. }));
    assert_eq!(read.views[0].limit, Some(50));
}

#[test]
fn una_vista_nuova_si_aggiunge_in_fondo_alla_lista() {
    let before = include_str!("fixtures/progetti.before.base");
    let after = include_str!("fixtures/progetti.aggiunta.after.base");
    let out = written(
        before,
        &BaseChange::AddView {
            name: "Nuova".into(),
            view_type: ViewType::Table,
        },
    );
    assert_eq!(out, after);
    assert_eq!(comments(&out), comments(before));
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert_eq!(read.views.len(), 3);
    assert_eq!(read.views[2].name, "Nuova");
}

#[test]
fn una_vista_in_mezzo_si_toglie_e_il_commento_fra_le_viste_resta() {
    let before = include_str!("fixtures/progetti.before.base");
    let after = include_str!("fixtures/progetti.tolta.after.base");
    let out = written(
        before,
        &BaseChange::RemoveView {
            view: "Tutti".into(),
        },
    );
    assert_eq!(out, after);
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert_eq!(read.views.len(), 1);
    assert_eq!(read.views[0].name, "Per stato");
    assert!(comments(&out).contains(&"  # La tabella di tutti i progetti."));
}

#[test]
fn l_ultima_vista_si_toglie_lasciando_una_lista_vuota_col_suo_commento() {
    let before = include_str!("fixtures/vista_unica.before.base");
    let after = include_str!("fixtures/vista_unica.after.base");
    let out = written(
        before,
        &BaseChange::RemoveView {
            view: "Tutte".into(),
        },
    );
    assert_eq!(out, after);
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert!(read.views.is_empty());
}

#[test]
fn un_filtro_scritto_come_parola_diventa_un_albero_e_il_commento_resta() {
    let before = include_str!("fixtures/filtro_tutto.before.base");
    let after = include_str!("fixtures/filtro_tutto.after.base");
    let change = set(
        "Tutte",
        ViewKey::Filters,
        json!({ "or": [
            { "condition": { "property": "tipo", "op": "is", "value": "idea" } },
            { "condition": { "property": "tipo", "op": "is", "value": "nota" } }
        ] }),
    );
    let out = written(before, &change);
    assert_eq!(out, after);
    assert_eq!(comments(&out), comments(before));
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert!(matches!(read.views[0].filters, FilterDef::Or(ref parts) if parts.len() == 2));
    assert_eq!(read.views[0].limit, Some(20));
}

#[test]
fn il_limite_si_scrive_nel_file_con_le_fini_di_riga_di_windows() {
    // I file del corpus restano in LF (`.gitattributes` normalizza il testo):
    // il CRLF lo fa il test, così la prova non dipende dal checkout.
    let before = include_str!("fixtures/crlf.before.base").replace('\n', "\r\n");
    let after = include_str!("fixtures/crlf.after.base").replace('\n', "\r\n");
    let out = written(&before, &set("Tutte", ViewKey::Limit, json!(5)));
    assert_eq!(out, after);
    assert!(
        !out.replace("\r\n", "").contains('\n'),
        "nessun a capo nudo"
    );
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert_eq!(read.views[0].limit, Some(5));
}

#[test]
fn una_base_senza_viste_ne_riceve_la_prima_in_fondo_al_file() {
    let before = include_str!("fixtures/senza_views.before.base");
    let after = include_str!("fixtures/senza_views.after.base");
    let out = written(
        before,
        &BaseChange::AddView {
            name: "Tutte".into(),
            view_type: ViewType::Table,
        },
    );
    assert_eq!(out, after);
    let read = BaseDefinition::parse(&out).expect("si rilegge");
    assert_eq!(read.views.len(), 1);
}

#[test]
fn una_chiave_in_yaml_di_flusso_si_rifiuta_senza_scrivere() {
    let before = include_str!("fixtures/progetti.before.base");
    let refused = apply(
        before,
        &BaseChange::SetKey {
            view: "Tutti".into(),
            key: ViewKey::Order,
            value: None,
        },
    )
    .expect_err("order è in flusso");
    assert!(
        matches!(
            refused,
            PatchError::Flow {
                place: Place::Key(ViewKey::Order)
            }
        ),
        "{refused:?}"
    );
}

#[test]
fn ancore_e_alias_nel_file_si_rifiutano_senza_scrivere() {
    let before = include_str!("fixtures/ancora.before.base");
    let refused = apply(before, &set("Liste", ViewKey::Limit, json!(3))).expect_err("ancora");
    assert!(
        matches!(
            refused,
            PatchError::Unsafe {
                construct: Construct::Anchor,
                ..
            }
        ),
        "{refused:?}"
    );
}

#[test]
fn un_file_illeggibile_o_con_due_documenti_si_rifiuta() {
    let broken = include_str!("fixtures/illeggibile.before.base");
    assert!(matches!(
        apply(broken, &set("Tutte", ViewKey::Limit, json!(3))),
        Err(PatchError::Unreadable)
    ));
    let nameless = include_str!("fixtures/senza_nome.before.base");
    assert!(matches!(
        apply(nameless, &set("Tutte", ViewKey::Limit, json!(3))),
        Err(PatchError::Unreadable)
    ));
    let two = include_str!("fixtures/due_documenti.before.base");
    assert!(matches!(
        apply(two, &set("Tutte", ViewKey::Limit, json!(3))),
        Err(PatchError::Unsafe {
            construct: Construct::Documents,
            ..
        })
    ));
}

#[test]
fn la_revisione_cambiata_fa_fallire_l_applicazione_e_non_scrive() {
    let before = include_str!("fixtures/progetti.before.base");
    let edits = apply(before, &set("Tutti", ViewKey::Limit, json!(9))).expect("si applica");
    let changed = format!("{before}# scritto altrove\n");
    let request = EditRequest::new(Revision::of(before), edits);
    assert!(
        request.apply_to(&changed).is_err(),
        "la base non combacia più"
    );
}
