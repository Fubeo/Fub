//! Un testo trasformato resta un testo (K6 T13, «distorci sul testo» e le trasformazioni): Ruota,
//! Scala, Inclina, Rifletti e Sposta leggermente scrivono la `transform` sul `text` stesso (mai su un
//! pezzo, un `tspan`), e il file, riaperto, ha ancora un testo modificabile con le sue parole.
//! Il testo di punto, quello in area e quello su tracciato sono provati con Inter, come i caratteri
//! che Fub porta.

#![cfg(feature = "completo")]

mod common;

use std::sync::Arc;

use fub_disegno::motore::{Disegni, Disegno};
use fub_scene::read;
use serde_json::{json, Value};
use vectorcraft_doc::NodeKind;

/// Il disegno con Inter e tutte le famiglie accese.
fn disegni() -> Arc<Disegni> {
    let disegni = common::disegni_con_inter();
    disegni.filtra(fub_disegno::famiglie::Filtro::Tutte);
    disegni
}

/// I tre testi del banco: di punto, in area, su tracciato. Ognuno ha il suo id e le sue parole.
const CASI: [(&str, &str, &str); 3] = [
    ("famiglie/trasforma/testo.svg", "ot1t1t1t1", "Ciao"),
    (
        "famiglie/trasforma/t13-testo-in-area.svg",
        "oz1z1z1z1",
        "Le onde del mare",
    ),
    (
        "famiglie/trasforma/t13-testo-su-tracciato.svg",
        "ot9t9t9t9",
        "Ciao",
    ),
];

/// I comandi di trasformazione che devono restare testi, con il loro valore.
fn comandi() -> Vec<(&'static str, Value)> {
    vec![
        ("object.rotate", json!({ "angle": 90 })),
        ("object.scale", json!({ "sx": 50 })),
        ("object.shear", json!({ "angle": 15, "axis": "horizontal" })),
        ("object.reflect", json!({ "axis": "vertical" })),
        ("object.nudge", json!({ "dx": 1 })),
    ]
}

/// Il file dopo il comando, o il rifiuto: le operazioni applicate al testo.
fn dopo(
    disegni: &Arc<Disegni>,
    svg: &str,
    id: &str,
    comando: &str,
    valore: Value,
) -> Result<String, String> {
    let (mut d, aperto) = Disegno::apri_con(disegni, svg).expect("si apre");
    let esito = d
        .comando(fub_abi::DrawingCommandRequest {
            revision: aperto.revision,
            id: format!("disegno.{comando}"),
            selection: vec![id.into()],
            value: valore,
            preview: false,
        })
        .expect("il comando risponde");
    if let Some(rifiuto) = esito.refused {
        let perche: Vec<String> = esito.losses.iter().map(|l| format!("{l:?}")).collect();
        return Err(format!("{rifiuto:?}: {}", perche.join("; ")));
    }
    let ops: Value =
        serde_json::from_str(&esito.ops.expect("il comando dà operazioni")).expect("json");
    // La trasformazione va sul testo stesso, non su un suo pezzo: l'unico id scritto è il testo.
    let mut scritti: Vec<String> = Vec::new();
    fn raccogli(op: &Value, scritti: &mut Vec<String>) {
        if let Some(figli) = op.get("ops").and_then(Value::as_array) {
            figli.iter().for_each(|f| raccogli(f, scritti));
        } else if let Some(id) = op.get("id").and_then(Value::as_str) {
            scritti.push(id.to_string());
        } else if let Some(id) = op.get("target").and_then(Value::as_str) {
            scritti.push(id.to_string());
        } else if let Some(id) = op
            .get("elem")
            .and_then(|e| e.get("attrs"))
            .and_then(|a| a.get("id"))
            .and_then(Value::as_str)
        {
            scritti.push(id.to_string());
        }
    }
    for op in ops.as_array().expect("una lista") {
        raccogli(op, &mut scritti);
    }
    // Un testo in area si riscrive per intero (un `remove` e un `add` con lo stesso id).
    assert!(
        !scritti.is_empty() && scritti.iter().all(|s| s == id),
        "{comando}: scrive {scritti:?}: {ops}"
    );
    Ok(common::applica::applica(svg, &ops).expect("le operazioni si applicano"))
}

/// Il file riaperto: nessuna perdita, un testo nel disegno, e le parole ancora nel file.
fn riaperto_come_testo(disegni: &Arc<Disegni>, originale: &str, svg: &str, id: &str, parole: &str) {
    // Le perdite che il file ha già aperto da solo (un tracciato in `defs`) non contano: conta che
    // la trasformazione non ne aggiunga.
    let (_, prima) = Disegno::apri_con(disegni, originale).expect("l'originale si apre");
    let (mut d, aperto) = Disegno::apri_con(disegni, svg).expect("il file riaperto si apre");
    assert!(
        aperto.losses.len() <= prima.losses.len(),
        "la trasformazione non aggiunge perdite alla riapertura: {:?}",
        aperto.losses
    );
    let mut testi = 0;
    let _ = d.a_mano(|doc, _| {
        doc.walk(|n| {
            if matches!(n.kind, NodeKind::Text(_)) {
                testi += 1;
            }
        });
    });
    assert_eq!(testi, 1, "il testo è un testo nel disegno riaperto");
    // Il testo in area resta in area dopo la trasformazione (Scala compresa): il file riaperto lo
    // legge così.
    if id == "oz1z1z1z1" {
        let mut in_area = 0;
        let _ = d.a_mano(|doc, _| {
            doc.walk(|n| {
                if let NodeKind::Text(t) = &n.kind {
                    if matches!(t.kind, vectorcraft_doc::text::TextKind::Area { .. }) {
                        in_area += 1;
                    }
                }
            });
        });
        assert_eq!(
            in_area, 1,
            "il testo in area resta in area dopo la trasformazione"
        );
    }
    let tag = svg
        .split("<text ")
        .nth(1)
        .and_then(|r| r.split('>').next())
        .unwrap_or("");
    assert!(
        tag.contains(&format!("id=\"{id}\"")),
        "il testo {id} è ancora un <text>: {tag}"
    );
    assert!(svg.contains(parole), "le parole {parole:?} ci sono ancora");
    // La scena lo legge come testo, non come elemento estraneo.
    let scena = read(svg).expect("la scena si legge");
    assert!(scena.read_only.is_empty(), "il file non è in sola lettura");
}

#[test]
fn le_trasformazioni_su_un_testo_restano_testi_e_si_riaprono() {
    let disegni = disegni();
    for (percorso, id, parole) in CASI {
        let svg = match percorso {
            "famiglie/trasforma/testo.svg" => include_str!("famiglie/trasforma/testo.svg"),
            "famiglie/trasforma/t13-testo-in-area.svg" => {
                include_str!("famiglie/trasforma/t13-testo-in-area.svg")
            }
            _ => include_str!("famiglie/trasforma/t13-testo-su-tracciato.svg"),
        };
        for (comando_id, valore) in comandi() {
            // Un testo in area resta orizzontale: Ruota, Inclina e Rifletti sono rifiutati su di lui.
            let in_area = percorso.contains("in-area");
            let ruota = matches!(
                comando_id,
                "object.rotate" | "object.shear" | "object.reflect"
            );
            let atteso_rifiuto = in_area && ruota;
            match dopo(&disegni, svg, id, comando_id, valore) {
                Ok(nuovo) => {
                    assert!(!atteso_rifiuto, "{comando_id} su {id}: doveva rifiutarsi");
                    riaperto_come_testo(&disegni, svg, &nuovo, id, parole);
                }
                Err(rifiuto) => {
                    assert!(
                        atteso_rifiuto,
                        "{comando_id} su {id}: rifiutato senza motivo: {rifiuto}"
                    );
                    assert!(
                        rifiuto.starts_with("Unsupported"),
                        "{comando_id} su {id}: {rifiuto}"
                    );
                }
            }
        }
    }
}

/// Il testo in area del banco con il `<text>` e le righe cambiati: `attributi` si aggiungono al
/// `<text>`, `seconda` sostituisce il `<tspan>` della seconda riga.
fn in_area(attributi: &str, seconda: Option<&str>) -> String {
    let svg = include_str!("famiglie/trasforma/t13-testo-in-area.svg");
    let mut svg = svg.replace(
        "font-size=\"20\" fub:wrap=\"200\"",
        &format!("font-size=\"20\"{attributi} fub:wrap=\"200\""),
    );
    if let Some(riga) = seconda {
        svg = svg.replace(
            "<tspan fub:join=\"space\" x=\"40\" dy=\"24\">tornano a riva</tspan>",
            riga,
        );
    }
    svg
}

/// Il valore di un attributo del `<text>` nel file.
fn attributo(svg: &str, nome: &str) -> Option<String> {
    let tag = format!(" {}", svg.split("<text ").nth(1)?.split('>').next()?);
    let da = tag
        .find(&format!(" {nome}=\""))
        .map(|i| i + nome.len() + 3)?;
    Some(tag[da..].split('"').next()?.to_string())
}

/// I `dy` delle righe nel file.
fn passi(svg: &str) -> Vec<String> {
    svg.split("<tspan ")
        .skip(1)
        .filter_map(|t| {
            let da = t.find(" dy=\"")? + 5;
            Some(t[da..].split('"').next()?.to_string())
        })
        .collect()
}

/// Il testo del disegno riaperto: in area, il corpo come lo mostra il motore, le righe.
fn testo_riaperto(disegni: &Arc<Disegni>, svg: &str) -> (bool, f64, usize) {
    let (mut d, aperto) = Disegno::apri_con(disegni, svg).expect("il file riaperto si apre");
    assert!(
        aperto.losses.is_empty(),
        "perdite alla riapertura: {:?}\n{svg}",
        aperto.losses
    );
    assert_eq!(aperto.unmapped, 0, "tutto resta modificabile:\n{svg}");
    let mut trovato = None;
    let _ = d.a_mano(|doc, _| {
        doc.walk(|n| {
            if let NodeKind::Text(t) = &n.kind {
                let area = matches!(t.kind, vectorcraft_doc::text::TextKind::Area { .. });
                let corpo = t
                    .runs
                    .first()
                    .and_then(|r| t.effective_char_style(&r.style))
                    .map_or(0.0, |s| s.size);
                let righe = vectorcraft_text::layout(vectorcraft_text::FontDb::global(), t)
                    .lines
                    .len();
                trovato = Some((area, corpo, righe));
            }
        });
    });
    trovato.expect("un testo nel disegno riaperto")
}

/// Annulla e Ripeti del client sono testo: il motore tiene al byte quello di prima e quello di
/// dopo.
fn annulla_e_ripeti(disegni: &Arc<Disegni>, prima: &str, dopo: &str) {
    let (mut d, _) = Disegno::apri_con(disegni, prima).expect("si apre");
    for testo in [dopo, prima, dopo] {
        d.sincronizza(fub_abi::DrawingSync {
            revision: d.revisione() + 1,
            change: fub_abi::DrawingChange::Text {
                text: testo.to_string(),
            },
        })
        .expect("il testo passa");
        assert!(d.aspetta_il_reimport(std::time::Duration::from_secs(30)));
        assert_eq!(d.testo(), testo, "Annulla e Ripeti al byte");
    }
}

/// Scala sul testo in area scala anche il corpo (e la spaziatura fra le lettere), come il motore lo
/// mostra; il contorno delle lettere resta largo come si vede, perché Scala del motore lo compensa: il passo delle righe resta coerente col corpo, e il file riaperto ha ancora
/// un testo in area, con le stesse righe. Prima il corpo restava 20 con le righe a metà passo, e
/// l'importatore le leggeva come pezzi di una riga sola: un testo di punto.
#[test]
fn scala_sul_testo_in_area_resta_in_area_dopo_la_riapertura() {
    let disegni = disegni();
    let automatica = in_area("", None);
    let esplicita = in_area(
        "",
        Some("<tspan fub:join=\"space\" x=\"40\" dy=\"36\">tornano a riva</tspan>"),
    );
    let spaziata = in_area(" letter-spacing=\"2\"", None);
    let contornata = in_area(" stroke=\"#ff0000\" stroke-width=\"2\"", None);
    let casi = [
        // (nome, file, scala %, corpo, spaziatura, contorno)
        ("automatica 50", &automatica, "50", "10", None, None),
        ("automatica 200", &automatica, "200", "40", None, None),
        ("automatica 25", &automatica, "25", "5", None, None),
        ("esplicita 50", &esplicita, "50", "10", None, None),
        ("esplicita 200", &esplicita, "200", "40", None, None),
        ("esplicita 25", &esplicita, "25", "5", None, None),
        ("spaziata 50", &spaziata, "50", "10", Some("1"), None),
        ("spaziata 200", &spaziata, "200", "40", Some("4"), None),
        ("contornata 50", &contornata, "50", "10", None, Some("2")),
    ];
    for (nome, svg, scala, corpo, spaziatura, contorno) in casi {
        let s: f64 = scala.parse::<f64>().unwrap() / 100.0;
        let (area, corpo_prima, righe_prima) = testo_riaperto(&disegni, svg);
        assert!(area, "{nome}: il banco è un testo in area");
        let nuovo = dopo(
            &disegni,
            svg,
            "oz1z1z1z1",
            "object.scale",
            json!({ "sx": scala.parse::<f64>().unwrap() }),
        )
        .unwrap_or_else(|r| panic!("{nome}: Scala si rifiuta: {r}"));
        assert_eq!(
            attributo(&nuovo, "font-size").as_deref(),
            Some(corpo),
            "{nome}: il corpo scala con il testo:\n{nuovo}"
        );
        assert_eq!(
            attributo(&nuovo, "letter-spacing").as_deref(),
            spaziatura,
            "{nome}: la spaziatura scala con il corpo:\n{nuovo}"
        );
        if let Some(c) = contorno {
            assert_eq!(
                attributo(&nuovo, "stroke-width").as_deref(),
                Some(c),
                "{nome}: il contorno delle lettere scala con il testo:\n{nuovo}"
            );
        }
        // Il passo delle righe scala con il corpo.
        let attesi: Vec<String> = passi(svg)
            .iter()
            .map(|p| {
                let v = p.parse::<f64>().unwrap() * s;
                format!("{v}")
            })
            .collect();
        assert_eq!(
            passi(&nuovo),
            attesi,
            "{nome}: il passo delle righe:\n{nuovo}"
        );
        let (area, corpo_dopo, righe_dopo) = testo_riaperto(&disegni, &nuovo);
        assert!(
            area,
            "{nome}: dopo Scala il testo in area resta in area:\n{nuovo}"
        );
        assert!(
            (corpo_dopo - corpo_prima * s).abs() < 1e-6,
            "{nome}: il corpo riaperto è {corpo_dopo}, non {}",
            corpo_prima * s
        );
        assert_eq!(
            righe_dopo, righe_prima,
            "{nome}: le stesse righe nel riquadro"
        );
        annulla_e_ripeti(&disegni, svg, &nuovo);
    }
}

/// Scala non uniforme su un testo in area: il testo schiacciato non si scrive con righe e corpo, quindi
/// si rifiuta come Ruota, Inclina e Rifletti (`Unsupported`, il perché resta nel ponte), senza
/// operazioni sul file.
#[test]
fn scala_non_uniforme_sul_testo_in_area_si_rifiuta() {
    let disegni = disegni();
    let svg = in_area("", None);
    let rifiuto = dopo(
        &disegni,
        &svg,
        "oz1z1z1z1",
        "object.scale",
        json!({ "sx": 50, "sy": 100 }),
    )
    .expect_err("Scala non uniforme non si scrive su un testo in area");
    assert!(rifiuto.starts_with("Unsupported"), "{rifiuto}");
}

/// Un `<text>` con `fub:wrap` e due stili (una riga in grassetto): il ponte lo apre come testo di
/// punto (i pezzi non sono uguali, `testi_in_area` in `apertura.rs`), con `fub:wrap` tenuto nel file.
/// Scala lo tratta da testo di punto: scrive la `transform`, lascia corpo e stili, e il file
/// riaperto è com'era, con Annulla e Ripeti al byte.
#[test]
fn scala_sul_testo_a_capo_con_due_stili_scrive_la_transform() {
    let disegni = disegni();
    let svg = in_area(
        "",
        Some("<tspan fub:join=\"space\" x=\"40\" dy=\"24\" font-weight=\"bold\">tornano a riva</tspan>"),
    );
    let (prima, corpo_prima, righe_prima) = testo_riaperto(&disegni, &svg);
    assert!(!prima, "con due stili il ponte apre un testo di punto");
    let nuovo = dopo(
        &disegni,
        &svg,
        "oz1z1z1z1",
        "object.scale",
        json!({ "sx": 50 }),
    )
    .expect("Scala si fa");
    assert!(
        attributo(&nuovo, "transform").is_some(),
        "la scala è una transform:\n{nuovo}"
    );
    assert_eq!(
        attributo(&nuovo, "font-size").as_deref(),
        Some("20"),
        "il corpo resta:\n{nuovo}"
    );
    assert_eq!(
        attributo(&nuovo, "fub:wrap").as_deref(),
        Some("200"),
        "fub:wrap resta:\n{nuovo}"
    );
    assert!(
        nuovo.contains("font-weight=\"bold\""),
        "lo stile resta:\n{nuovo}"
    );
    let (dopo_area, corpo_dopo, righe_dopo) = testo_riaperto(&disegni, &nuovo);
    assert!(!dopo_area, "resta un testo di punto");
    assert!(
        (corpo_dopo - corpo_prima * 0.5).abs() < 1e-6,
        "si vede a metà: {corpo_dopo}"
    );
    assert_eq!(righe_dopo, righe_prima);
    annulla_e_ripeti(&disegni, &svg, &nuovo);
}

/// Il testo di punto non cambia comportamento: Scala scrive la `transform` e lascia il corpo.
#[test]
fn scala_sul_testo_di_punto_non_tocca_il_corpo() {
    let disegni = disegni();
    let svg = include_str!("famiglie/trasforma/testo.svg");
    let corpo = attributo(svg, "font-size");
    let nuovo = dopo(
        &disegni,
        svg,
        "ot1t1t1t1",
        "object.scale",
        json!({ "sx": 50 }),
    )
    .expect("Scala si fa");
    assert_eq!(
        attributo(&nuovo, "font-size"),
        corpo,
        "il corpo resta:\n{nuovo}"
    );
    assert!(
        attributo(&nuovo, "transform").is_some(),
        "la scala è una transform:\n{nuovo}"
    );
    annulla_e_ripeti(&disegni, svg, &nuovo);
}
