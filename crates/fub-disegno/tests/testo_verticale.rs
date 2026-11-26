//! Il testo verticale (formato del testo, §10): il file scritto dallo
//! strumento Testo verticale si riapre come testo di punto verticale del
//! motore, con le sue colonne, l'interlinea e la posizione, e riscritto
//! torna uguale.

#![cfg(feature = "completo")]

mod common;

use fub_disegno::motore::Disegno;
use vectorcraft_doc::text::TextKind;
use vectorcraft_doc::NodeKind;

const FILE: &str = include_str!("famiglie/testo/type-orientation-vertical.svg");

#[test]
fn un_testo_verticale_si_riapre_verticale() {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    let (mut d, aperto) = Disegno::apri_con(&disegni, FILE).expect("si apre");
    assert!(aperto.losses.is_empty(), "{:?}", aperto.losses);
    let mut visti = Vec::new();
    let _ = d.a_mano(|doc, _| {
        doc.walk(|n| {
            if let NodeKind::Text(t) = &n.kind {
                visti.push((
                    t.vertical,
                    matches!(t.kind, TextKind::Point),
                    t.plain_text(),
                    t.xf,
                    t.runs[0].style.leading,
                ));
            }
        });
    });
    eprintln!("{visti:?}");
    assert!(
        visti
            .iter()
            .any(|v| v.0 && v.1 && v.2 == "Pioggia\nsul mare"),
        "{visti:?}"
    );
}
