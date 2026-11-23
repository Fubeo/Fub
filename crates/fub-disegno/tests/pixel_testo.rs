#![cfg(feature = "completo")]
//! «Rendi perfetto al pixel» su un testo (K6 T13), da solo. Il caso sta fuori dalla prova delle famiglie:
//! la misura del testo dipende dai caratteri già caricati nel processo, e lì il caso cambiava con gli
//! altri (una scala diversa). Da solo il testo ha solo una traslazione, come il motore la scrive.

mod casi;
mod common;

use casi::cartella_famiglie;
use fub_abi::DrawingCommandRequest;
use fub_disegno::motore::Disegno;

#[test]
fn rendi_perfetto_un_testo_lo_sposta_senza_scalarlo() {
    let disegni = casi::disegni_di_prova();
    let testo = std::fs::read_to_string(cartella_famiglie().join("trasforma/pixel.svg")).unwrap();
    let (mut d, _) = Disegno::apri_con(&disegni, &testo).unwrap();
    let esito = d
        .comando(DrawingCommandRequest {
            revision: d.revisione(),
            id: "disegno.object.makePixelPerfect".into(),
            selection: vec!["oh8h8h8h8".into()],
            value: serde_json::json!({}),
            preview: false,
        })
        .unwrap();
    let ops = esito.ops.expect("il testo si sposta");
    assert!(
        ops.contains(r#""transform":"matrix(1 0 0 1 "#),
        "solo una traslazione: {ops}"
    );
    assert!(
        ops.contains(r#""id":"oh8h8h8h8""#),
        "il testo scelto: {ops}"
    );
}
