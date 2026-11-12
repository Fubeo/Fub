//! I comandi del disegno sul motore: il colore del tratto, quello del
//! riempimento e lo spessore, con l'esito come differenza; e il registro dei
//! comandi del motore, che deve avere ancora gli id che si usano.

mod common;

use common::{apri, confronta_ops, ops_di, Confronto};
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

/// Un colore dato a chi non ha quel tratto o riempimento si scrive come lo
/// scrive il pannello del client: l'attributo, e basta.
#[test]
fn un_tratto_o_un_riempimento_che_non_c_era() {
    let (mut d, _) = apri(&disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n    <rect id=\"ob2b2b2b2\" x=\"10\" y=\"10\" width=\"10\" height=\"10\" fill=\"none\" stroke=\"#000000\"/>\n",
    ));
    assert!(d
        .comandi(&["oa1a1a1a1".into()])
        .iter()
        .any(|c| c.id == DRAWING_COMMAND_STROKE_COLOR && c.enabled));
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_STROKE_COLOR,
            &["oa1a1a1a1"],
            json!("#ff0000")
        ),
        set("oa1a1a1a1", json!({ "stroke": "#ff0000" }))
    );
    assert!(d
        .comandi(&["ob2b2b2b2".into()])
        .iter()
        .any(|c| c.id == DRAWING_COMMAND_FILL_COLOR && c.enabled));
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["ob2b2b2b2"],
            json!("#00ff00")
        ),
        set("ob2b2b2b2", json!({ "fill": "#00ff00" }))
    );
    // Insieme, nello stesso passo.
    let entrambi = ops(
        &mut d,
        DRAWING_COMMAND_FILL_COLOR,
        &["oa1a1a1a1", "ob2b2b2b2"],
        json!("#0000ff"),
    );
    assert_eq!(
        entrambi,
        json!([{ "op": "batch", "ops": [
            { "op": "set", "id": "oa1a1a1a1", "attrs": { "fill": "#0000ff" } },
            { "op": "set", "id": "ob2b2b2b2", "attrs": { "fill": "#0000ff" } }
        ]}])
    );
}

/// Il riempimento di un testo è il `fill` del `<text>`, come nel client; il
/// colore del tratto non lo tocca.
#[test]
fn il_riempimento_di_un_testo() {
    let (mut d, _) = apri(&disegno(
        "    <text id=\"oc0ffee01\" x=\"10\" y=\"40\" font-size=\"20\" fill=\"#000000\"><tspan x=\"10\" dy=\"0\">Ciao</tspan></text>\n",
    ));
    assert_eq!(
        ops(
            &mut d,
            DRAWING_COMMAND_FILL_COLOR,
            &["oc0ffee01"],
            json!("#ff0000")
        ),
        set("oc0ffee01", json!({ "fill": "#ff0000" }))
    );
    assert_eq!(
        rifiuto(
            &mut d,
            DRAWING_COMMAND_STROKE_COLOR,
            &["oc0ffee01"],
            json!("#ff0000")
        ),
        DrawingRefusal::Empty
    );
}

/// Lo spessore di una freccia riscrive anche la sua punta, lunga 3 × lo
/// spessore + 6 (`arrowPath` del client, dal `fub:geom`).
#[test]
fn lo_spessore_di_una_freccia_riscrive_la_punta() {
    let (mut d, _) = apri(&disegno(
        "    <path id=\"ofreccia1\" fub:shape=\"arrow\" fub:geom=\"10 20 110 20\" d=\"M10 20 L110 20 M95.28 25.5 L110 20 L95.28 14.5\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\"/>\n",
    ));
    // Punta 3 × 4 + 6 = 18, lati a 30°: 110 − 18·cos 30° = 94.41, 20 ± 9.
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["ofreccia1"], json!(4)),
        set(
            "ofreccia1",
            json!({
                "stroke-width": "4",
                "d": "M10 20 L110 20 M94.41 29 L110 20 L94.41 11"
            })
        )
    );
}

/// Un tratteggio del menu si rimisura sul nuovo spessore (`dashValue` del
/// client); uno che il menu non conosce resta com'è.
#[test]
fn lo_spessore_rimisura_il_tratteggio_del_menu() {
    let (mut d, _) = apri(&disegno(
        "    <rect id=\"oa1a1a1a1\" x=\"10\" y=\"10\" width=\"50\" height=\"50\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\" stroke-dasharray=\"8 6\"/>\n    <rect id=\"ob2b2b2b2\" x=\"100\" y=\"10\" width=\"50\" height=\"50\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-dasharray=\"6 8\"/>\n    <rect id=\"oc3c3c3c3\" x=\"200\" y=\"10\" width=\"50\" height=\"50\" fill=\"none\" stroke=\"#000000\" stroke-width=\"2\" stroke-dasharray=\"5 5\"/>\n",
    ));
    // A tratti (4, 3 spessori), estremi piatti.
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["oa1a1a1a1"], json!(3)),
        set(
            "oa1a1a1a1",
            json!({ "stroke-width": "3", "stroke-dasharray": "12 9" })
        )
    );
    // Estremi tondi: mezzo spessore per parte passa dal trattino allo spazio.
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["ob2b2b2b2"], json!(3)),
        set(
            "ob2b2b2b2",
            json!({ "stroke-width": "3", "stroke-dasharray": "9 12" })
        )
    );
    assert_eq!(
        ops(&mut d, DRAWING_COMMAND_WIDTH, &["oc3c3c3c3"], json!(3)),
        set("oc3c3c3c3", json!({ "stroke-width": "3" }))
    );
}

/// Un caso di `tests/corpus/spessore-variabile.json`: lo spessore delle
/// linee a spessore variabile come lo scrive il client (`widthTo`).
struct Variabile {
    nome: String,
    input: String,
    selezione: Vec<String>,
    spessore: Value,
    ops: Value,
}

fn variabili() -> Vec<Variabile> {
    let percorso = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus/spessore-variabile.json");
    let testo = std::fs::read_to_string(&percorso).expect("i vettori ci sono");
    let tutto: Value = serde_json::from_str(&testo).expect("i vettori in JSON");
    tutto["vettori"]
        .as_array()
        .expect("un elenco")
        .iter()
        .map(|v| Variabile {
            nome: v["name"].as_str().expect("un nome").to_string(),
            input: v["input"].as_str().expect("un disegno").to_string(),
            selezione: v["selection"]
                .as_array()
                .expect("una selezione")
                .iter()
                .map(|s| s.as_str().expect("un id").to_string())
                .collect(),
            spessore: v["width"].clone(),
            ops: in_un_batch(&v["ops"]),
        })
        .collect()
}

/// Le operazioni del client come le manda il motore: più di una sta in un
/// `batch` (`Differenza` in `src/differenza.rs`).
fn in_un_batch(ops: &Value) -> Value {
    match ops.as_array() {
        Some(o) if o.len() > 1 => json!([{ "op": "batch", "ops": o }]),
        _ => ops.clone(),
    }
}

/// Lo spessore di una linea a spessore variabile riscala il profilo e ne
/// ricalcola il contorno pieno: il `fub:geom` e il `d` sono quelli del client
/// (al centesimo, nella tolleranza dei confronti); lo stesso spessore e lo
/// spessore zero non cambiano niente.
#[test]
fn lo_spessore_di_una_linea_a_spessore_variabile_e_quello_del_client() {
    let vettori = variabili();
    let scritti = vettori
        .iter()
        .filter(|v| v.ops.as_array().is_some_and(|o| !o.is_empty()))
        .count();
    assert!(scritti >= 3, "pochi vettori con un contorno: {scritti}");
    let mut diverse = Vec::new();
    for v in &vettori {
        let (mut d, _) = apri(&v.input);
        let selezione: Vec<&str> = v.selezione.iter().map(String::as_str).collect();
        let esito = d
            .comando(richiesta(
                DRAWING_COMMAND_WIDTH,
                &selezione,
                v.spessore.clone(),
            ))
            .expect("la richiesta vale");
        if v.ops.as_array().is_some_and(Vec::is_empty) {
            if esito.refused != Some(DrawingRefusal::Empty) {
                diverse.push(format!("{}: atteso empty, avuto {esito:?}", v.nome));
            }
            continue;
        }
        if esito.refused.is_some() {
            diverse.push(format!("{}: rifiutato {:?}", v.nome, esito.refused));
            continue;
        }
        if let Confronto::Diverse(perche) = confronta_ops(&v.ops, &ops_di(&esito), None) {
            diverse.push(format!("{}: {perche}", v.nome));
        }
    }
    assert!(diverse.is_empty(), "{}", diverse.join("\n"));
}

const VARIABILE: &str = "    <path id=\"ovariab01\" fub:shape=\"width\" fub:geom=\"round round 0 2 2 1 2 2 M0 0 L100 0\" d=\"M0 2 A2 2 0 0 1 -2 0 A2 2 0 0 1 0 -2 L100 -2 A2 2 0 0 1 102 0 A2 2 0 0 1 100 2 Z\" fill=\"#000000\"/>\n";

#[test]
fn lo_spessore_e_acceso_su_una_linea_a_spessore_variabile() {
    let (d, _) = apri(&disegno(VARIABILE));
    assert!(d
        .comandi(&["ovariab01".into()])
        .iter()
        .any(|c| c.id == DRAWING_COMMAND_WIDTH && c.enabled));
}

/// Una selezione con una linea variabile e un rettangolo: il rettangolo
/// cambia `stroke-width`, la linea il profilo e il contorno.
#[test]
fn lo_spessore_di_una_linea_variabile_insieme_a_una_forma() {
    let (mut d, _) = apri(&disegno(&format!("{RETTANGOLO}{VARIABILE}")));
    let ottenute = ops(
        &mut d,
        DRAWING_COMMAND_WIDTH,
        &["oa1a1a1a1", "ovariab01"],
        json!(6),
    );
    let attese = in_un_batch(&json!([
        { "op": "set", "id": "oa1a1a1a1", "attrs": { "stroke-width": "6" } },
        { "op": "set", "id": "ovariab01", "attrs": {
            "fub:geom": "round round 0 3 3 1 3 3 M0 0 L100 0",
            "d": "M0 3 A3 3 0 0 1 -3 0 A3 3 0 0 1 0 -3 L100 -3 A3 3 0 0 1 103 0 A3 3 0 0 1 100 3 Z"
        } }
    ]));
    assert_eq!(
        confronta_ops(&attese, &ottenute, None),
        Confronto::Uguali,
        "{ottenute}"
    );
}
