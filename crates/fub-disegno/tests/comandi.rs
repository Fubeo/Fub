//! I comandi del disegno sul motore: il colore del tratto, quello del
//! riempimento e lo spessore, con l'esito come differenza; e il registro dei
//! comandi del motore, che deve avere ancora gli id che si usano.

mod common;

use common::{apri, ops_di};
use fub_abi::{
    DrawingCommandRequest, DrawingRefusal, PluginError, DRAWING_COMMANDS,
    DRAWING_COMMAND_FILL_COLOR, DRAWING_COMMAND_STROKE_COLOR, DRAWING_COMMAND_WIDTH,
};
use fub_disegno::comandi::{chiamate_di_prova, controlla_registro, COMANDI};
use fub_disegno::motore::Disegno;
use serde_json::{json, Value};

const TESTA: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n";

/// Un disegno con un livello che tiene `dentro`.
fn disegno(dentro: &str) -> String {
    format!(
        "{TESTA}  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n{dentro}  </g>\n</svg>\n"
    )
}

const RETTANGOLO: &str = "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\" stroke=\"#000000\" stroke-width=\"2\"/>\n";

fn richiesta(id: &str, selezione: &[&str], valore: Value) -> DrawingCommandRequest {
    DrawingCommandRequest {
        revision: 0,
        id: id.into(),
        selection: selezione.iter().map(|s| s.to_string()).collect(),
        value: valore,
    }
}

/// Le operazioni dell'esito, che non deve essere un rifiuto.
fn ops(d: &mut Disegno, id: &str, selezione: &[&str], valore: Value) -> Value {
    let esito = d
        .comando(richiesta(id, selezione, valore))
        .expect("la richiesta vale");
    assert_eq!(esito.refused, None, "rifiutato: {esito:?}");
    assert_eq!(
        esito.selection,
        selezione.iter().map(|s| s.to_string()).collect::<Vec<_>>()
    );
    ops_di(&esito)
}

/// Il rifiuto dell'esito, che non ha operazioni.
fn rifiuto(d: &mut Disegno, id: &str, selezione: &[&str], valore: Value) -> DrawingRefusal {
    let esito = d
        .comando(richiesta(id, selezione, valore))
        .expect("la richiesta vale");
    assert_eq!(esito.ops, None);
    esito.refused.expect("un rifiuto")
}

fn set(id: &str, attrs: Value) -> Value {
    json!([{ "op": "set", "id": id, "attrs": attrs }])
}

#[test]
fn il_colore_del_tratto_su_un_rettangolo_e_un_solo_set_di_stroke() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    let ottenute = ops(
        &mut d,
        DRAWING_COMMAND_STROKE_COLOR,
        &["oa1a1a1a1"],
        json!("#ff0000"),
    );
    assert_eq!(ottenute, set("oa1a1a1a1", json!({ "stroke": "#ff0000" })));
    // La sessione è tornata alla copia: lo stesso comando dà lo stesso esito.
    let ancora = ops(
        &mut d,
        DRAWING_COMMAND_STROKE_COLOR,
        &["oa1a1a1a1"],
        json!("#FF0000"),
    );
    assert_eq!(ancora, ottenute);
}

#[test]
fn il_colore_none_toglie_il_tratto_e_il_riempimento() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_STROKE_COLOR,
            &["oa1a1a1a1"],
            json!("none")
        ),
        set("oa1a1a1a1", json!({ "stroke": "none" }))
    );
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oa1a1a1a1"],
            Value::Null
        ),
        set("oa1a1a1a1", json!({ "fill": "none" }))
    );
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oa1a1a1a1"],
            json!(" none ")
        ),
        set("oa1a1a1a1", json!({ "fill": "none" }))
    );
}

#[test]
fn il_riempimento_scrive_il_colore_in_sei_cifre() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oa1a1a1a1"],
            json!("#00f")
        ),
        set("oa1a1a1a1", json!({ "fill": "#0000ff" }))
    );
}

#[test]
fn lo_stesso_colore_non_cambia_niente() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    assert_eq!(
        rifiuto(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oa1a1a1a1"],
            json!("#000000")
        ),
        DrawingRefusal::Empty
    );
}

#[test]
fn lo_spessore_si_scrive_nelle_unita_dell_elemento() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["oa1a1a1a1"], json!(3.5)),
        set("oa1a1a1a1", json!({ "stroke-width": "3.5" }))
    );
    // Dentro un gruppo che raddoppia, lo spessore resta quello dato.
    let (mut d, _) = apri(&disegno(
        "    <g id=\"ogruppo01\" transform=\"scale(2)\">\n      <rect id=\"ob2b2b2b2\" x=\"0\" y=\"0\" width=\"10\" height=\"10\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\"/>\n    </g>\n",
    ));
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["ob2b2b2b2"], json!(5)),
        set("ob2b2b2b2", json!({ "stroke-width": "5" }))
    );
}

#[test]
fn lo_spessore_zero_si_scrive_zero_anche_su_una_linea() {
    let (mut d, _) = apri(&disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\" stroke=\"#000000\" stroke-width=\"2\"/>\n    <line id=\"olinea001\" x1=\"10\" y1=\"10\" x2=\"90\" y2=\"40\" stroke=\"#000000\" stroke-width=\"2\"/>\n",
    ));
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["oa1a1a1a1"], json!(0)),
        set("oa1a1a1a1", json!({ "stroke-width": "0" }))
    );
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["olinea001"], json!(0)),
        set("olinea001", json!({ "stroke-width": "0" }))
    );
}

#[test]
fn un_valore_che_non_vale_e_bad_args() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    let casi = [
        (DRAWING_COMMAND_WIDTH, json!(-1)),
        (DRAWING_COMMAND_WIDTH, json!("3")),
        (DRAWING_COMMAND_STROKE_COLOR, Value::Null),
        (DRAWING_COMMAND_STROKE_COLOR, json!(3)),
        (DRAWING_COMMAND_STROKE_COLOR, json!("rosso")),
        (DRAWING_COMMAND_STROKE_COLOR, json!("#ff00")),
        (DRAWING_COMMAND_STROKE_COLOR, json!("#ff000080")),
        (DRAWING_COMMAND_FILL_COLOR, json!("rgb(1, 2, 3)")),
        (DRAWING_COMMAND_FILL_COLOR, json!(false)),
    ];
    for (id, valore) in casi {
        let esito = d.comando(richiesta(id, &["oa1a1a1a1"], valore.clone()));
        assert!(
            matches!(esito, Err(PluginError::BadArgs(_))),
            "{id} {valore}: {esito:?}"
        );
    }
    assert_eq!(d.revisione(), 0);
}

#[test]
fn un_id_che_il_motore_non_serve_e_unsupported() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    assert_eq!(
        rifiuto(&mut d, "disegno.altro", &["oa1a1a1a1"], json!(1)),
        DrawingRefusal::Unsupported
    );
}

#[test]
fn una_selezione_con_un_elemento_non_mappato_non_cambia_niente() {
    let testo = disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n    <image id=\"oimmagin1\" x=\"0\" y=\"0\" width=\"10\" height=\"10\" href=\"data:,\"/>\n",
    );
    let (mut d, aperto) = apri(&testo);
    // Un id che nel disegno non c'è.
    assert_eq!(
        rifiuto(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oa1a1a1a1", "onessuno1"],
            json!("#ff0000")
        ),
        DrawingRefusal::Unmapped
    );
    assert!(d
        .comandi(&["oa1a1a1a1".into(), "onessuno1".into()])
        .iter()
        .all(|c| !c.enabled));
    if aperto.unmapped > 0 {
        // L'immagine, se il motore non la sa modificare.
        assert_eq!(
            rifiuto(
                &mut d,
                DRAWING_COMMAND_FILL_COLOR,
                &["oa1a1a1a1", "oimmagin1"],
                json!("#ff0000")
            ),
            DrawingRefusal::Unmapped
        );
    }
    assert_eq!(d.testo(), testo);
}

/// Decisione K5 T16: un elemento con un filtro è mappato, ma `perdite`
/// rifiuta ogni cambio che non sia la sua `transform`.
#[test]
fn un_elemento_con_un_filtro_e_unmapped() {
    let testo = format!(
        "{TESTA}  <defs>\n    <filter id=\"fsfoca\"><feGaussianBlur stdDeviation=\"2\"/></filter>\n  </defs>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"ofiltrat\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\" filter=\"url(#fsfoca)\"/>\n    <rect id=\"onormale\" x=\"250\" y=\"100\" width=\"50\" height=\"50\" fill=\"#000000\"/>\n  </g>\n</svg>\n"
    );
    let (mut d, _) = apri(&testo);
    assert_eq!(
        rifiuto(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["onormale", "ofiltrat"],
            json!("#ff0000")
        ),
        DrawingRefusal::Unmapped
    );
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["onormale"],
            json!("#ff0000")
        ),
        set("onormale", json!({ "fill": "#ff0000" }))
    );
}

#[test]
fn un_gruppo_colora_i_suoi_figli_tranne_i_bloccati() {
    let (mut d, _) = apri(&disegno(
        "    <g id=\"ogruppo01\">\n      <rect id=\"ob2b2b2b2\" x=\"0\" y=\"0\" width=\"10\" height=\"10\" fill=\"#000000\" stroke=\"#000000\"/>\n      <rect id=\"oc3c3c3c3\" x=\"20\" y=\"0\" width=\"10\" height=\"10\" fill=\"#000000\" stroke=\"#000000\" fub:locked=\"true\"/>\n      <line id=\"olinea001\" x1=\"0\" y1=\"30\" x2=\"40\" y2=\"30\" stroke=\"#000000\"/>\n    </g>\n",
    ));
    // La linea non ha riempimento, il rettangolo bloccato resta com'è.
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["ogruppo01"],
            json!("#ff0000")
        ),
        set("ob2b2b2b2", json!({ "fill": "#ff0000" }))
    );
    // Il tratto va alla linea e ai rettangoli non bloccati.
    let tratto = ops(
        &mut d,
        DRAWING_COMMAND_STROKE_COLOR,
        &["ogruppo01"],
        json!("#00ff00"),
    );
    let testo = tratto.to_string();
    assert!(
        testo.contains("ob2b2b2b2") && testo.contains("olinea001"),
        "{testo}"
    );
    assert!(
        !testo.contains("oc3c3c3c3") && !testo.contains("ogruppo01"),
        "{testo}"
    );
}

/// La differenza non sa scrivere un tratto o un riempimento che l'oggetto
/// non aveva: il comando è `unsupported` e spento, mai a metà.
#[test]
fn un_tratto_o_un_riempimento_che_non_c_e_e_unsupported() {
    let testo = disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n    <rect id=\"ob2b2b2b2\" x=\"10\" y=\"10\" width=\"10\" height=\"10\" fill=\"#000000\" stroke=\"#000000\"/>\n",
    );
    let (mut d, _) = apri(&testo);
    assert_eq!(
        rifiuto(
            &mut d,
            DRAWING_COMMAND_STROKE_COLOR,
            &["ob2b2b2b2", "oa1a1a1a1"],
            json!("#ff0000")
        ),
        DrawingRefusal::Unsupported
    );
    let accesi: Vec<(String, bool)> = d
        .comandi(&["oa1a1a1a1".into()])
        .into_iter()
        .map(|c| (c.id, c.enabled))
        .collect();
    assert_eq!(
        accesi,
        vec![
            (DRAWING_COMMAND_STROKE_COLOR.to_string(), false),
            (DRAWING_COMMAND_FILL_COLOR.to_string(), true),
            // Un rettangolo senza contorno non ha uno spessore da cambiare.
            (DRAWING_COMMAND_WIDTH.to_string(), false),
        ]
    );
    assert_eq!(d.testo(), testo);
}

/// Un rettangolo con `fill="none"` non ha un riempimento nel motore: oggi
/// il comando è spento e `unsupported` (vedi sopra).
#[test]
fn il_riempimento_di_un_rettangolo_vuoto_e_spento() {
    let (mut d, _) = apri(&disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"none\" stroke=\"#000000\"/>\n",
    ));
    assert_eq!(
        rifiuto(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oa1a1a1a1"],
            json!("#ff0000")
        ),
        DrawingRefusal::Unsupported
    );
    let riempimento = d
        .comandi(&["oa1a1a1a1".into()])
        .into_iter()
        .find(|c| c.id == DRAWING_COMMAND_FILL_COLOR)
        .expect("c'è");
    assert!(!riempimento.enabled);
}

#[test]
fn un_elemento_scelto_bloccato_e_locked() {
    let (mut d, _) = apri(&disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\" fub:locked=\"true\"/>\n",
    ));
    assert_eq!(
        rifiuto(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oa1a1a1a1"],
            json!("#ff0000")
        ),
        DrawingRefusal::Locked
    );
}

#[test]
fn il_tratto_di_una_penna_e_il_suo_riempimento() {
    let (mut d, _) = apri(&disegno(
        "    <path id=\"openna001\" fub:tool=\"pen\" fub:brush=\"pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0\" d=\"M120.5 30.2 Q121 30.1 121.4 30 Z\" fill=\"#d55e00\" fub:ink=\"1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8\"/>\n",
    ));
    let esito = d
        .comando(richiesta(
            DRAWING_COMMAND_STROKE_COLOR,
            &["openna001"],
            json!("#ff0000"),
        ))
        .expect("vale");
    // Se il motore lo sa modificare, cambia il riempimento; mai il tratto.
    if esito.refused.is_none() {
        assert_eq!(
            ops_di(&esito),
            set("openna001", json!({ "fill": "#ff0000" }))
        );
    } else {
        assert_eq!(esito.refused, Some(DrawingRefusal::Unmapped));
    }
}

#[test]
fn lo_spessore_di_una_freccia_o_di_un_tratteggio_non_lo_fa_il_motore() {
    let (mut d, _) = apri(&disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\" stroke-dasharray=\"4 2\"/>\n",
    ));
    assert_eq!(
        rifiuto(&mut d, DRAWING_COMMAND_WIDTH, &["oa1a1a1a1"], json!(4)),
        DrawingRefusal::Unsupported
    );
    let spessore = d
        .comandi(&["oa1a1a1a1".into()])
        .into_iter()
        .find(|c| c.id == DRAWING_COMMAND_WIDTH)
        .expect("c'è");
    assert!(!spessore.enabled);
}

#[test]
fn i_comandi_sono_accesi_su_una_selezione_mappata() {
    let (d, _) = apri(&disegno(RETTANGOLO));
    let accesi = d.comandi(&["oa1a1a1a1".into()]);
    assert_eq!(
        accesi.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
        DRAWING_COMMANDS.to_vec()
    );
    assert!(accesi.iter().all(|c| c.enabled), "{accesi:?}");
    assert!(d.comandi(&[]).iter().all(|c| !c.enabled));
}

#[test]
fn una_richiesta_vecchia_e_stale() {
    let (mut d, _) = apri(&disegno(RETTANGOLO));
    let mut r = richiesta(DRAWING_COMMAND_FILL_COLOR, &["oa1a1a1a1"], json!("#ff0000"));
    r.revision = 7;
    let esito = d.comando(r).expect("vale");
    assert_eq!(esito.refused, Some(DrawingRefusal::Stale));
}

#[test]
fn il_registro_del_motore_ha_i_comandi_che_si_usano() {
    for (fub, motore) in COMANDI {
        assert!(DRAWING_COMMANDS.contains(&fub), "{fub}");
        assert_eq!(controlla_registro(motore, &json!({})), Ok(()), "{motore}");
    }
    for (id, parametri) in chiamate_di_prova() {
        assert_eq!(controlla_registro(id, &parametri), Ok(()));
    }
    // Un id cambiato a mano: il controllo lo dice.
    let errore = controlla_registro("paint.setStrokeColour", &json!({ "color": "#ff0000" }))
        .expect_err("l'id non c'è");
    assert!(errore.contains("paint.setStrokeColour"), "{errore}");
    // Un parametro che il motore non nomina.
    assert!(controlla_registro("stroke.set", &json!({ "peso": 2 })).is_err());
}
