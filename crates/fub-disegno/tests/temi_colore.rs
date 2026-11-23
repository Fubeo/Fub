//! I temi del colore (piano K6, T14, temi; la famiglia `colore`): la libreria
//! dei temi sta nelle preferenze del motore, cioè nell'impostazione
//! `draw.motore`, come le altre preferenze del motore. Qui si prova la parte
//! che il banco dei casi non vede: che cosa l'host riceve da salvare
//! (`prendi_le_preferenze_cambiate`), e che un'istanza nuova, aperta con le
//! preferenze salvate (`apri_con_preferenze`), ritrova i temi.
//!
//! Il file del disegno non cambia con i temi: salvare e togliere sono letture,
//! senza un passo d'annulla.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use common::disegni;
use fub_abi::{DrawingCommandRequest, DrawingOutcome};
use fub_disegno::famiglie::Filtro;
use fub_disegno::motore::{Disegni, Disegno};
use serde_json::{json, Value};

const BASE: &str = include_str!("famiglie/colore/base.svg");

fn motore() -> Arc<Disegni> {
    let ds = disegni();
    ds.filtra(Filtro::Tutte);
    ds
}

fn apri(ds: &Arc<Disegni>, testo: &str) -> Disegno {
    let (d, _) = Disegno::apri_con(ds, testo).expect("il disegno si apre");
    d
}

fn comando(d: &mut Disegno, id: &str, valore: Value) -> DrawingOutcome {
    d.comando(DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: vec![],
        value: valore,
        preview: false,
    })
    .expect("il comando gira")
}

#[test]
fn salvare_un_tema_non_cambia_il_disegno_e_l_host_riceve_la_chiave_dei_temi() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    let prima_del_file = d.testo().to_string();
    let esito = comando(
        &mut d,
        "colorTheme.save",
        json!({ "colors": ["#ff0000", "#00ff00"], "name": "Tramonto" }),
    );
    // Il risultato è la lettura (nome e numero), e il file è quello di prima: niente passo.
    assert!(esito.refused.is_none(), "{esito:?}");
    assert!(
        esito.ops.is_none(),
        "salvare un tema non cambia il disegno: {esito:?}"
    );
    assert_eq!(d.testo(), prima_del_file);
    assert_eq!(esito.reading.as_ref().unwrap()["name"], "Tramonto");
    // L'host riceve la libreria dei temi come impostazione `colorThemes`, da salvare in `draw.motore`.
    let cambi = d.prendi_le_preferenze_cambiate();
    let temi = cambi
        .dopo
        .get("colorThemes")
        .expect("la libreria dei temi è cambiata");
    assert_eq!(temi[0]["name"], "Tramonto");
    // Nelle preferenze un colore è `{model, r, g, b}` (0..1): il rosso pieno, poi il verde pieno.
    assert_eq!(temi[0]["colors"][0]["r"], 1.0);
    assert_eq!(temi[0]["colors"][1]["g"], 1.0);
}

#[test]
fn un_istanza_nuova_con_le_preferenze_salvate_ritrova_il_tema() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    // Un nome non ASCII, come «Tramonto è», deve tornare uguale dopo il salvataggio.
    comando(
        &mut d,
        "colorTheme.save",
        json!({ "colors": ["#ff0000"], "name": "Tramonto è" }),
    );
    let salvate = d.preferenze();
    // L'istanza nuova nasce con le preferenze di `draw.motore`, come all'avvio dell'app.
    let (mut nuova, _, avvisi) =
        Disegno::apri_con_preferenze(&ds, BASE, &salvate).expect("il disegno si apre");
    assert!(avvisi.is_empty(), "{avvisi:?}");
    let lista = comando(&mut nuova, "colorTheme.list", json!({}));
    let temi = &lista.reading.expect("una lettura")["themes"];
    assert_eq!(temi[0]["name"], "Tramonto è", "{temi}");
    assert_eq!(temi[0]["colors"], json!(["#ff0000"]));
}

#[test]
fn togliere_l_ultimo_tema_riporta_la_lista_di_serie_che_l_host_non_tiene() {
    let ds = motore();
    let mut d = apri(&ds, BASE);
    comando(
        &mut d,
        "colorTheme.save",
        json!({ "colors": ["#ff0000"], "name": "Solo" }),
    );
    let _ = d.prendi_le_preferenze_cambiate();
    let esito = comando(&mut d, "colorTheme.delete", json!({ "name": "Solo" }));
    assert_eq!(esito.reading.as_ref().unwrap()["deleted"], "Solo");
    assert!(esito.ops.is_none());
    // La lista vuota è quella di serie: l'host la toglie da `draw.motore` (e_di_serie).
    let cambi = d.prendi_le_preferenze_cambiate();
    let vuota = cambi.dopo.get("colorThemes").expect("la lista è cambiata");
    assert_eq!(vuota, &json!([]));
    assert!(fub_disegno::preferenze::e_di_serie(
        &fub_disegno::preferenze::di_serie(),
        "colorThemes",
        vuota
    ));
}
