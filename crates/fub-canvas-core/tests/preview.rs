//! L'anteprima di una lavagna (`fub_canvas_core::preview`): il disegno SVG di tre
//! lavagne contro il suo atteso (una con testo lungo tagliato, una con caratteri
//! speciali, una con la forma di tutti i pezzi), i limiti di misura e di numero,
//! i caratteri che XML non ammette, e la stima di `layout` che il testo rispetta.
//!
//! Il golden si rigenera con `UPDATE_PREVIEW=1 cargo test -p fub-canvas-core
//! --test preview`, e solo quando il cambio di disegno è voluto.

use std::path::PathBuf;

use fub_canvas_core::check::Code;
use fub_canvas_core::describe::{outline, DescribeOptions};
use fub_canvas_core::layout::estimate_text_height;
use fub_canvas_core::preview::{
    after_ops, sketch, sketch_svg, SketchOptions, MAX_OUTLINE, MAX_SIDE, MIN_SIDE,
};
use fub_canvas_core::{parse, Canvas};
use serde_json::{json, Value};

/// La forma: un gruppo con la sua etichetta, schede coi colori di serie e col
/// proprio esadecimale, un collegamento, un file con sottopercorso, archi con
/// lati, senza lati, con etichette e con le punte da tutte e due le parti.
const FORMA: &str = r###"{
  "nodes": [
    {"id":"gruppo","type":"group","x":-40,"y":-80,"width":560,"height":400,"label":"Idee del mese"},
    {"id":"t1","type":"text","x":0,"y":0,"width":320,"height":160,"color":"4","text":"## Ciclo dell'acqua\n\nL'**acqua** evapora, sale e torna [[Nuvole|le nuvole]]."},
    {"id":"t2","type":"text","x":400,"y":0,"width":320,"height":160,"color":"3","text":"Evaporazione"},
    {"id":"f1","type":"file","file":"Scienze/nuvole.md","subpath":"#Pioggia","x":0,"y":240,"width":320,"height":160},
    {"id":"l1","type":"link","url":"https://example.org/ciclo-dell-acqua","x":400,"y":240,"width":320,"height":120,"color":"#7847a6"},
    {"id":"n1","type":"text","x":800,"y":0,"width":200,"height":120,"text":"senza colore"}
  ],
  "edges": [
    {"id":"e1","fromNode":"t1","fromSide":"right","toNode":"t2","toSide":"left","label":"porta a","color":"1"},
    {"id":"e2","fromNode":"t2","fromSide":"bottom","toNode":"l1","toSide":"top"},
    {"id":"e3","fromNode":"t1","fromSide":"bottom","toNode":"f1","toSide":"top","label":"da leggere","color":"#7847a6"},
    {"id":"e4","fromNode":"f1","fromSide":"right","toNode":"l1","toSide":"left","fromEnd":"arrow","toEnd":"arrow"},
    {"id":"e5","fromNode":"t2","toNode":"n1"}
  ]
}"###;

/// La scheda lunga: trenta righe in una scheda di 160, una scheda che entra
/// tutta, una bassa che dice poco, una vuota.
fn tagliata() -> String {
    let long: String = (1..=30)
        .map(|i| format!("riga {i:02}"))
        .collect::<Vec<_>>()
        .join("\n");
    json!({
        "nodes": [
            {"id":"lunga","type":"text","x":0,"y":0,"width":320,"height":160,"text":long},
            {"id":"corta","type":"text","x":400,"y":0,"width":320,"height":160,"text":"Due righe\nentrano."},
            {"id":"bassa","type":"text","x":800,"y":0,"width":320,"height":40,"text":"Una scheda bassa\nnon dice tutto."},
            {"id":"vuota","type":"text","x":0,"y":240,"width":320,"height":160,"text":""}
        ],
        "edges": []
    })
    .to_string()
}

/// I caratteri che un SVG non sopporta o che sono di Markdown: `<`, `&`, `]]>`,
/// virgolette, un controllo, emoji, scrittura da destra a sinistra, CJK, e il
/// testo di un gruppo, di un file e di un arco con gli stessi caratteri.
const CARATTERI: &str = r##"{
  "nodes": [
    {"id":"a","type":"text","x":0,"y":0,"width":320,"height":160,"text":"<b>&amp;</b> ]]> \"doppie\" 'singole'"},
    {"id":"b","type":"text","x":400,"y":0,"width":320,"height":160,"text":"emoji 👋🌍 e cinese 漢字","color":"#112233"},
    {"id":"c","type":"text","x":0,"y":240,"width":320,"height":160,"text":"ebraico שלום עולם","color":"#ffee00"},
    {"id":"d","type":"text","x":400,"y":240,"width":320,"height":160,"text":"controllo \u0007 e tab\tqui\n# non titolo"},
    {"id":"g","type":"group","x":-40,"y":-80,"width":800,"height":560,"label":"Gruppo & <amici>"},
    {"id":"f","type":"file","file":"cartelle/<strano>&.pdf","x":800,"y":240,"width":320,"height":120}
  ],
  "edges": [
    {"id":"e","fromNode":"a","toNode":"b","label":"<x> & ]]>"}
  ]
}"##;

/// Una lavagna di una scheda per specie, per confrontare le specie con la lettura.
const SPECIE: &str = r##"{
  "nodes": [
    {"id":"t","type":"text","x":0,"y":0,"width":200,"height":100,"text":"testo"},
    {"id":"n","type":"file","file":"nota.md","x":0,"y":200,"width":200,"height":100},
    {"id":"d","type":"file","file":"rel.docx","x":0,"y":400,"width":200,"height":100},
    {"id":"s","type":"file","file":"fogli.xlsx","x":0,"y":600,"width":200,"height":100},
    {"id":"p","type":"file","file":"libro.pdf","x":0,"y":800,"width":200,"height":100},
    {"id":"i","type":"file","file":"foto.PNG","x":300,"y":0,"width":200,"height":100},
    {"id":"o","type":"file","file":"c.zip","x":300,"y":200,"width":200,"height":100},
    {"id":"w","type":"link","url":"https://example.org","x":300,"y":400,"width":200,"height":100},
    {"id":"g","type":"group","x":-100,"y":-100,"width":700,"height":1100,"label":"G"}
  ],
  "edges": []
}"##;

fn board(text: &str, width: i64, height: i64) -> Canvas {
    let source = json!({
        "nodes": [{"id":"a","type":"text","x":0,"y":0,"width":width,"height":height,"text":text}],
        "edges": []
    })
    .to_string();
    parse(&source).expect("la lavagna di prova si legge")
}

fn grid(count: usize) -> Canvas {
    let nodes: Vec<Value> = (0..count)
        .map(|i| {
            json!({
                "id": format!("n{i}"),
                "type": "text",
                "x": (i % 100) * 240,
                "y": (i / 100) * 120,
                "width": 200,
                "height": 80,
                "text": format!("Scheda {i}")
            })
        })
        .collect();
    parse(&json!({ "nodes": nodes, "edges": [] }).to_string()).expect("la griglia si legge")
}

/// Confronta `svg` con il file atteso `tests/preview/<name>.svg`.
fn golden(name: &str, svg: &str) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/preview")
        .join(format!("{name}.svg"));
    if std::env::var_os("UPDATE_PREVIEW").is_some() {
        std::fs::write(&path, svg).expect("il golden si scrive");
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "manca {}: rigeneralo con UPDATE_PREVIEW=1 cargo test -p fub-canvas-core --test preview",
            path.display()
        )
    });
    assert_eq!(
        svg, expected,
        "il disegno di «{name}» è cambiato: se è voluto, rigeneralo con UPDATE_PREVIEW=1"
    );
}

#[test]
fn la_forma_di_tutti_i_pezzi_e_il_suo_atteso() {
    let canvas = parse(FORMA).expect("la forma si legge");
    golden("forma", &sketch_svg(&canvas, &SketchOptions::default()));
}

#[test]
fn il_testo_tagliato_e_il_suo_atteso_e_dice_clipped() {
    let canvas = parse(&tagliata()).expect("la lavagna tagliata si legge");
    golden("tagliata", &sketch_svg(&canvas, &SketchOptions::default()));

    let drawn = sketch(&canvas, &SketchOptions::default());
    let clipped: Vec<(&str, bool)> = drawn
        .outline
        .iter()
        .map(|card| (card.id.as_str(), card.clipped))
        .collect();
    assert_eq!(
        clipped,
        vec![
            ("lunga", true),
            ("corta", false),
            ("bassa", true),
            ("vuota", false),
        ],
        "la lunga taglia, la bassa mostra una riga e dice che il testo continua, la vuota non ha testo"
    );
}

#[test]
fn i_caratteri_speciali_e_il_loro_atteso() {
    let canvas = parse(CARATTERI).expect("i caratteri si leggono");
    let svg = sketch_svg(&canvas, &SketchOptions::default());
    golden("caratteri", &svg);

    // Il testo sta in sezioni CDATA: `<`, `&` e le virgolette restano come sono,
    // e il `]]>` del testo si spezza fra due sezioni. Ogni `]]>` chiude una
    // sezione, quindi i due conti coincidono.
    assert!(
        svg.contains("<![CDATA[<b>&amp;</b> ]]]]><![CDATA[> \"doppie\" 'singole']]>"),
        "{svg}"
    );
    assert_eq!(svg.matches("]]>").count(), svg.matches("<![CDATA[").count());
    assert!(
        !svg.contains('\u{7}'),
        "il controllo esce come segno sostitutivo"
    );
    assert!(svg.contains('\u{FFFD}'));
    // Il titolo di Markdown sulla seconda riga è testo, senza il suo `# `.
    assert!(svg.contains("<![CDATA[non titolo]]></text>"), "{svg}");
    assert!(!svg.contains("# non titolo"));
}

#[test]
fn una_lavagna_vuota_e_un_quadrato_di_64() {
    let svg = sketch_svg(&Canvas::default(), &SketchOptions::default());
    assert!(
        svg.contains("width=\"64\" height=\"64\" viewBox=\"0 0 64 64\""),
        "{svg}"
    );
    assert!(!svg.contains("<text"));
    let drawn = sketch(&Canvas::default(), &SketchOptions::default());
    assert_eq!((drawn.width, drawn.height), (64, 64));
    assert!(drawn.outline.is_empty());
    assert_eq!(drawn.outline_omitted, 0);
}

#[test]
fn una_lavagna_larga_e_bassa_ha_il_lato_corto_di_64() {
    let canvas = parse(
        r#"{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":100000,"height":10,"text":"lunga"}],"edges":[]}"#,
    )
    .expect("si legge");
    let drawn = sketch(&canvas, &SketchOptions::default());
    assert_eq!((drawn.width, drawn.height), (1024, 64));
}

#[test]
fn il_lato_lungo_si_stringe_fra_64_e_2048() {
    let canvas = board("testo", 320, 160);
    let big = sketch(
        &canvas,
        &SketchOptions {
            size: 10_000,
            ordinals: true,
        },
    );
    assert_eq!(big.width.max(big.height), MAX_SIDE);
    let small = sketch(
        &canvas,
        &SketchOptions {
            size: 0,
            ordinals: true,
        },
    );
    assert_eq!(small.width.max(small.height), MIN_SIDE);
    let default = sketch(&canvas, &SketchOptions::default());
    assert_eq!(default.width.max(default.height), 1024);
}

#[test]
fn una_scheda_che_sta_nella_stima_di_layout_non_taglia() {
    // La scheda alta quanto la stima di `layout` ha tutte le sue righe; una
    // più bassa di una riga le taglia. Così la stima e l'anteprima dicono lo
    // stesso numero di righe.
    let texts = [
        (0..6)
            .map(|i| format!("riga {i}"))
            .collect::<Vec<_>>()
            .join("\n"),
        (0..9)
            .map(|i| format!("riga {i}"))
            .collect::<Vec<_>>()
            .join("\n"),
        (0..40)
            .map(|i| format!("riga {i}"))
            .collect::<Vec<_>>()
            .join("\n"),
        vec!["x".repeat(100); 7].join("\n"),
    ];
    for text in texts {
        let height = estimate_text_height(&text, 320.0) as i64;
        let fits = sketch(&board(&text, 320, height), &SketchOptions::default());
        assert!(!fits.outline[0].clipped, "alta {height}: {text:?}");
        let short = sketch(&board(&text, 320, height - 24), &SketchOptions::default());
        assert!(short.outline[0].clipped, "alta {}: {text:?}", height - 24);
    }
}

#[test]
fn una_scheda_di_duemila_righe_si_taglia_e_non_rallenta() {
    let text: String = (0..2000).map(|i| format!("riga {i}\n")).collect();
    let canvas = board(&text, 320, 160);
    let drawn = sketch(&canvas, &SketchOptions::default());
    assert!(drawn.outline[0].clipped);
    // Cinque righe entrano in 160 di altezza (la stima), e il resto non esce.
    assert_eq!(drawn.svg.matches("font-size=\"14\"").count(), 5);
}

#[test]
fn le_specie_sono_quelle_della_lettura() {
    let canvas = parse(SPECIE).expect("le specie si leggono");
    let read = outline(&canvas, &DescribeOptions::default());
    let drawn = sketch(&canvas, &SketchOptions::default());
    assert_eq!(drawn.outline.len(), canvas.nodes.len());
    for card in &drawn.outline {
        let line = read
            .lines()
            .nth(card.number)
            .expect("una riga per scheda, dopo quella dei conti");
        let kind = line.split(' ').nth(2).expect("numero, id, specie");
        assert_eq!(card.kind, kind, "la scheda {}", card.id);
    }
    // Il numero d'ordine è la posizione nel modello, come nella lettura.
    assert_eq!(drawn.outline[0].number, 1);
    assert_eq!(drawn.outline.last().map(|card| card.number), Some(9));
}

#[test]
fn una_freccia_arriva_al_lato_scelto() {
    let canvas = parse(
        r#"{"nodes":[
            {"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"A"},
            {"id":"b","type":"text","x":200,"y":0,"width":100,"height":50,"text":"B"}
        ],"edges":[{"id":"e","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left"}]}"#,
    )
    .expect("si legge");
    let svg = sketch_svg(&canvas, &SketchOptions::default());
    // La punta sta sul lato sinistro di b (x 200, y 25), la coda sul lato destro di a (x 100).
    assert!(svg.contains("points=\"200,25 "), "{svg}");
    assert!(svg.contains("x1=\"100\" y1=\"25\""), "{svg}");
}

#[test]
fn una_freccia_senza_lato_va_al_bordo_non_al_centro() {
    // Centro a centro: la punta è sul bordo di b, a x 200, non al suo centro.
    let canvas = parse(
        r#"{"nodes":[
            {"id":"a","type":"text","x":0,"y":0,"width":100,"height":50,"text":"A"},
            {"id":"b","type":"text","x":200,"y":0,"width":100,"height":50,"text":"B"}
        ],"edges":[{"id":"e","fromNode":"a","toNode":"b"}]}"#,
    )
    .expect("si legge");
    let svg = sketch_svg(&canvas, &SketchOptions::default());
    assert!(svg.contains("points=\"200,25 "), "{svg}");
    assert!(svg.contains("x1=\"100\" y1=\"25\""), "{svg}");
}

#[test]
fn diecimila_schede_piccole_non_mostrano_testo_e_il_conto_dell_elenco_e_esatto() {
    let canvas = grid(10_000);
    let drawn = sketch(&canvas, &SketchOptions::default());
    assert_eq!(drawn.outline.len(), MAX_OUTLINE);
    assert_eq!(drawn.outline_omitted, 10_000 - MAX_OUTLINE);
    // Su 1024 pixel una scheda di 80 unità è alta meno di 12 pixel: niente testo,
    // niente numeri, e la scheda dice di avere un testo che non si vede.
    assert!(!drawn.svg.contains("<clipPath"));
    assert!(drawn.outline.iter().all(|card| card.clipped));
}

#[cfg(not(debug_assertions))]
#[test]
fn diecimila_schede_sotto_i_due_secondi_in_release() {
    use std::time::Instant;

    let canvas = grid(10_000);
    let started = Instant::now();
    let _ = sketch(&canvas, &SketchOptions::default());
    assert!(
        started.elapsed().as_secs_f64() < 2.0,
        "{:?}",
        started.elapsed()
    );
}

#[test]
fn le_operazioni_disegnano_la_lavagna_di_dopo_senza_toccarla() {
    let canvas = parse(FORMA).expect("si legge");
    let before = canvas.clone();
    let list = json!([
        {"op":"add_card","node":{"id":"nuova","type":"text","x":900,"y":0,"width":200,"height":120,"text":"Nuova"}}
    ]);
    let after = after_ops(&canvas, &list, 7).expect("la lista si disegna");
    assert_eq!(after.nodes.len(), canvas.nodes.len() + 1);
    assert!(after.nodes.iter().any(|node| node.id == "nuova"));
    assert_eq!(canvas, before, "la lavagna di partenza non cambia");
}

#[test]
fn una_lista_che_non_si_scrive_dà_i_suoi_problemi() {
    let canvas = parse(FORMA).expect("si legge");
    let list = json!([{"op":"move","ids":["manca"],"dx":1,"dy":0}]);
    let problems = after_ops(&canvas, &list, 7).expect_err("l'id non c'è");
    assert_eq!(problems[0].code, Code::UnknownNode);
    assert_eq!(problems[0].index, Some(0));
}

#[test]
fn un_testo_con_una_riga_sola_che_non_entra_finisce_con_i_puntini() {
    // Un'altezza di 40 dà una riga sola, e il «…» dice che il testo continua.
    let drawn = sketch(&board("uno\ndue", 320, 40), &SketchOptions::default());
    assert!(drawn.outline[0].clipped);
    assert!(
        drawn.svg.contains("<![CDATA[uno…]]></text>"),
        "{}",
        drawn.svg
    );
}
