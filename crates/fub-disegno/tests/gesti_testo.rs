//! Il Testo del motore del disegno: il vettore scritto a mano
//! `tests/gesti/testo.json` (l'atteso è ciò che dà `textElem` di
//! `apps/client/src/editors/spatial/tools/text.ts`) e i vettori del Testo
//! registrati dalla strada semplice del client (`testo-clic` e gli altri di
//! `apps/client/src/__fixtures__/disegno-gesti/`) rigiocati sul motore, e i
//! casi limite: senza testo, un clic su un testo che c'è, fuori dal foglio,
//! caratteri che le facce non hanno, una riga lunghissima, un testo
//! `xml:space="preserve"` spostato, la griglia, il trascinamento, il livello
//! bloccato.

mod common;

use std::path::Path;

use common::{ammesse, confronta_ops, ops_di, radice, vettori, Confronto};
use fub_abi::{DrawingGesture, DrawingOutcome, DrawingRefusal};
use fub_disegno::motore::{Disegni, Disegno};
use fub_motori::{Caratteri, Config, Generiche, Servizi, Tetto};
use serde_json::{json, Value};

/// Apre `testo` su un motore con le facce di Inter che Fub porta: i colpi
/// sui testi vogliono le lettere disposte.
fn apri(testo: &str) -> (Disegno, fub_abi::DrawingOpen) {
    let servizi = Servizi::nuovi(Config {
        fili: Some(2),
        tetto: Tetto::fisso(256 * 1024 * 1024),
    });
    let facce: [&'static [u8]; 4] = [
        include_bytes!("../../fub-features/fonts/inter-400.ttf"),
        include_bytes!("../../fub-features/fonts/inter-700.ttf"),
        include_bytes!("../../fub-features/fonts/inter-italic-400.ttf"),
        include_bytes!("../../fub-features/fonts/inter-italic-700.ttf"),
    ];
    let generiche = Generiche {
        serif: "Inter".into(),
        sans: "Inter".into(),
        mono: "Inter".into(),
    };
    servizi
        .fornisci_caratteri(Caratteri::nuovi(facce, generiche))
        .unwrap_or_else(|_| panic!("i caratteri si danno una volta sola"));
    Disegno::apri_con(&Disegni::nuovi(servizi), testo)
        .unwrap_or_else(|e| panic!("il disegno non si apre: {e}"))
}

fn gesto(v: Value) -> DrawingGesture {
    serde_json::from_value(v).expect("il gesto si legge")
}

fn vettore() -> Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/gesti/testo.json");
    serde_json::from_str(&std::fs::read_to_string(&p).expect("leggo testo.json")).expect("JSON")
}

// ---------------------------------------------------------------------------
// L'applicazione di un `add` in fondo a un genitore, come la scrive il client
// (`writeElement` di `scene/serialize.ts`): solo ciò che serve al vettore.
// ---------------------------------------------------------------------------

/// Il posto di un attributo nell'ordine canonico del client (§7 del formato):
/// `id`, la geometria, la presentazione. Un attributo che qui non c'è fa
/// fallire la prova invece di finire in un posto a caso.
fn posto(nome: &str) -> usize {
    const ORDINE: [&str; 7] = ["id", "x", "y", "dy", "fill", "font-family", "font-size"];
    ORDINE
        .iter()
        .position(|n| *n == nome)
        .unwrap_or_else(|| panic!("attributo {nome} fuori dall'ordine della prova"))
}

fn escape(s: &str, attributo: bool) -> String {
    let mut fuori = String::new();
    for c in s.chars() {
        match c {
            '&' => fuori.push_str("&amp;"),
            '<' => fuori.push_str("&lt;"),
            '>' => fuori.push_str("&gt;"),
            '"' if attributo => fuori.push_str("&quot;"),
            c => fuori.push(c),
        }
    }
    fuori
}

fn scrivi(elem: &Value, rientro: &str) -> String {
    let tag = elem["tag"].as_str().expect("tag");
    let mut attrs: Vec<(&String, &Value)> =
        elem["attrs"].as_object().expect("attrs").iter().collect();
    attrs.sort_by_key(|(k, _)| posto(k));
    let mut out = format!("<{tag}");
    for (k, v) in attrs {
        out += &format!(" {k}=\"{}\"", escape(v.as_str().expect("valore"), true));
    }
    let figli = elem["children"].as_array().cloned().unwrap_or_default();
    if !figli.is_empty() {
        let dentro = format!("{rientro}  ");
        out.push('>');
        for f in &figli {
            out += &format!("\n{dentro}{}", scrivi(f, &dentro));
        }
        return format!("{out}\n{rientro}</{tag}>");
    }
    match elem["text"].as_str() {
        Some(t) if !t.is_empty() => format!("{out}>{}</{tag}>", escape(t, false)),
        _ => format!("{out}/>"),
    }
}

/// `testo` dopo le operazioni `ops`: un solo `add` in fondo a un livello.
fn applica(testo: &str, ops: &Value) -> String {
    let [op] = &ops.as_array().expect("un elenco")[..] else {
        panic!("la prova applica un'operazione sola: {ops}")
    };
    assert_eq!(op["op"], "add");
    assert_eq!(op["pos"], json!({ "last": true }));
    let parent = op["parent"].as_str().expect("parent");
    let apre = testo
        .find(&format!("id=\"{parent}\""))
        .expect("il genitore");
    let riga = testo[..apre].rfind('\n').map_or(0, |i| i + 1);
    let rientro: String = testo[riga..].chars().take_while(|c| *c == ' ').collect();
    let chiude = apre
        + testo[apre..]
            .find(&format!("\n{rientro}</g>"))
            .expect("la chiusura");
    let dentro = format!("{rientro}  ");
    format!(
        "{}\n{dentro}{}{}",
        &testo[..chiude],
        scrivi(&op["elem"], &dentro),
        &testo[chiude..]
    )
}

/// Gli id nuovi di `esito` scritti `@1`, `@2`… come nei vettori.
fn canonico(esito: &DrawingOutcome, s: &str) -> String {
    let mut fuori = s.to_string();
    let mut n = 0;
    fn ids(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| ids(x, out)),
            Value::Object(o) => {
                if o.get("op").and_then(Value::as_str) == Some("add") {
                    if let Some(id) = o["elem"]["attrs"]["id"].as_str() {
                        out.push(id.to_string());
                    }
                }
                o.values().for_each(|x| ids(x, out));
            }
            _ => {}
        }
    }
    let mut nuovi = Vec::new();
    ids(&ops_di(esito), &mut nuovi);
    for id in nuovi {
        n += 1;
        fuori = fuori.replace(&id, &format!("@{n}"));
    }
    fuori
}

#[test]
fn il_vettore_del_testo() {
    let v = vettore();
    let atteso = &v["expect"];
    let (mut d, _) = apri(v["input"].as_str().expect("input"));
    let esito = d.gesto(gesto(v["gesture"].clone())).expect("il gesto");
    assert_eq!(esito.refused, None);
    let ops = ops_di(&esito);
    match confronta_ops(&atteso["ops"], &ops, None) {
        Confronto::Uguali => {}
        altro => panic!("{altro:?}"),
    }
    // Il clic a (100, 80): l'ancora e la riga.
    let elem = &ops[0]["elem"];
    assert_eq!(
        (&elem["attrs"]["x"], &elem["attrs"]["y"]),
        (&json!("100"), &json!("80"))
    );
    assert_eq!(elem["children"][0]["text"], "Testo");
    // L'id nuovo è la selezione.
    let selezione: Vec<String> = esito
        .selection
        .iter()
        .map(|s| canonico(&esito, s))
        .collect();
    assert_eq!(json!(selezione), atteso["selection"]);
    // Il file dopo l'applicazione.
    let dopo = applica(v["input"].as_str().expect("input"), &ops);
    assert_eq!(
        canonico(&esito, &dopo),
        atteso["text"].as_str().expect("text")
    );
}

/// Le differenze ammesse fra il Testo del motore e i vettori registrati dalla
/// strada semplice del client.
fn percorso_tsv() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/gesti/testo.tsv")
}

fn rifiuto(r: Option<DrawingRefusal>) -> Option<String> {
    r.map(|r| {
        serde_json::to_value(r)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default()
    })
}

/// Ogni vettore del Testo registrato dal client (`apps/client/src/__fixtures__/
/// disegno-gesti/`, la strada semplice senza motore) rigiocato sul motore:
/// le stesse operazioni, lo stesso rifiuto, la stessa selezione e lo stesso
/// testo dopo; una differenza è ammessa solo se `tests/gesti/testo.tsv` la
/// nomina col perché.
#[test]
fn rigioca_i_vettori_del_testo() {
    let ammesse = ammesse(&percorso_tsv());
    let dir = radice().join("apps/client/src/__fixtures__/disegno-gesti");
    let mut diverse = Vec::new();
    let mut nomi = Vec::new();
    for v in vettori() {
        if v.gesto["tool"] != "text" {
            continue;
        }
        nomi.push(v.nome.clone());
        let file: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{}.json", v.nome))).expect("il vettore"),
        )
        .expect("JSON");
        let atteso = file["expect"]["text"].as_str().expect("expect.text");
        let input = v.input.replace("\r\n", "\n");
        let (mut d, _) = apri(&input);
        let esito = d.gesto(gesto(v.gesto.clone())).expect("il gesto");
        let ammessa = ammesse.get(&v.nome).map(String::as_str);
        let ops = ops_di(&esito);
        match confronta_ops(&v.ops, &ops, ammessa) {
            Confronto::Uguali | Confronto::Ammessa(_) => {}
            Confronto::Diverse(perche) => diverse.push(format!("{}: {perche}", v.nome)),
        }
        if ammessa.is_some() {
            continue;
        }
        if rifiuto(esito.refused) != v.rifiuto {
            diverse.push(format!(
                "{}: rifiuto {:?} ≠ {:?}",
                v.nome,
                rifiuto(esito.refused),
                v.rifiuto
            ));
        }
        let selezione: Vec<String> = esito
            .selection
            .iter()
            .map(|s| canonico(&esito, s))
            .collect();
        if selezione != v.selezione {
            diverse.push(format!(
                "{}: selezione {selezione:?} ≠ {:?}",
                v.nome, v.selezione
            ));
        }
        let dopo = if ops.is_null() {
            input.clone()
        } else {
            canonico(&esito, &applica(&input, &ops))
        };
        if dopo != atteso {
            diverse.push(format!("{}: il testo dopo\n{dopo}\n≠\n{atteso}", v.nome));
        }
    }
    assert!(
        nomi.iter().any(|n| n == "testo-clic"),
        "manca il vettore testo-clic: {nomi:?}"
    );
    for (nome, perche) in &ammesse {
        assert!(
            nomi.contains(nome),
            "testo.tsv nomina {nome}, che non è un vettore del Testo"
        );
        assert!(!perche.is_empty(), "testo.tsv: {nome} non dice perché");
    }
    assert!(diverse.is_empty(), "{}", diverse.join("\n"));
}

const DISEGNO: &str ="<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:fub=\"https://fubeo.github.io/ns/scene/1\" fub:version=\"1\" viewBox=\"0 0 400 300\" width=\"400\" height=\"300\">\n  <rect id=\"fub-paper\" fub:role=\"paper\" x=\"0\" y=\"0\" width=\"400\" height=\"300\" fill=\"#ffffff\"/>\n  <g id=\"l1a2b3c4d\" fub:layer=\"Livello 1\">\n    <rect id=\"oa1a1a1a1\" x=\"100\" y=\"100\" width=\"100\" height=\"50\" fill=\"#000000\"/>\n    <text id=\"ot1t1t1t1\" x=\"40\" y=\"240\" font-family=\"Inter, sans-serif\" font-size=\"32\" fill=\"#000000\" xml:space=\"preserve\"><tspan x=\"40\" dy=\"0\">Ciao   a  tutti</tspan></text>\n    <g id=\"og1g1g1g1\">\n      <text id=\"ot2t2t2t2\" x=\"240\" y=\"60\" font-family=\"Inter, sans-serif\" font-size=\"32\" fill=\"#000000\"><tspan x=\"240\" dy=\"0\">Dentro</tspan></text>\n    </g>\n  </g>\n</svg>\n";

fn evento(kind: &str, x: f64, y: f64) -> Value {
    json!({ "kind": kind, "x": x, "y": y, "pressure": 0.5, "shift": false, "alt": false, "cmd": false })
}

fn richiesta(tool: &str, testo: Option<&str>, eventi: Vec<Value>) -> Value {
    json!({
        "tool": tool,
        "layer": null,
        "selection": [],
        "zoom": 1,
        "snap": { "grid": null, "free": false },
        "style": if tool == "select" { Value::Null } else { json!({ "stroke": "#000000", "width": 4, "fill": null }) },
        "text": testo,
        "events": eventi,
    })
}

fn clic(testo: &str, riga: Option<&str>, p: (f64, f64)) -> DrawingOutcome {
    let (mut d, _) = apri(testo);
    d.gesto(gesto(richiesta(
        "text",
        riga,
        vec![evento("down", p.0, p.1), evento("up", p.0, p.1)],
    )))
    .expect("il gesto")
}

fn elem_aggiunto(esito: &DrawingOutcome) -> Value {
    let ops = ops_di(esito);
    assert_eq!(ops[0]["op"], "add", "{ops}");
    ops[0]["elem"].clone()
}

#[test]
fn senza_testo_o_con_una_riga_vuota_e_empty() {
    for riga in [None, Some(""), Some("  \t ")] {
        let esito = clic(DISEGNO, riga, (100.0, 80.0));
        assert_eq!(
            (esito.ops, esito.refused),
            (None, Some(DrawingRefusal::Empty)),
            "{riga:?}"
        );
    }
}

#[test]
fn un_clic_su_un_testo_che_c_e_lo_sceglie_come_la_selezione() {
    // Sopra la linea di base, dentro le lettere.
    for (p, atteso) in [((60.0, 230.0), "ot1t1t1t1"), ((260.0, 50.0), "og1g1g1g1")] {
        let esito = clic(DISEGNO, Some("Testo"), p);
        assert_eq!(esito.ops, None, "{p:?}");
        assert_eq!(esito.refused, None, "{p:?}");
        assert_eq!(esito.selection, vec![atteso.to_string()], "{p:?}");
        let (mut d, _) = apri(DISEGNO);
        let sel = d
            .gesto(gesto(richiesta(
                "select",
                None,
                vec![evento("down", p.0, p.1), evento("up", p.0, p.1)],
            )))
            .expect("il gesto");
        assert_eq!(esito.selection, sel.selection, "come la Selezione, {p:?}");
    }
}

#[test]
fn un_clic_su_una_forma_o_fuori_dal_foglio_crea_li() {
    let sulla_forma = elem_aggiunto(&clic(DISEGNO, Some("Testo"), (150.0, 120.0)));
    assert_eq!(sulla_forma["attrs"]["x"], "150");
    let fuori = clic(DISEGNO, Some("Testo"), (520.5, -40.25));
    let elem = elem_aggiunto(&fuori);
    assert_eq!(
        (&elem["attrs"]["x"], &elem["attrs"]["y"]),
        (&json!("520.5"), &json!("-40.25"))
    );
    assert_eq!(
        elem["children"][0]["attrs"],
        json!({ "x": "520.5", "dy": "0" })
    );
    assert_eq!(
        fuori.selection,
        vec![elem["attrs"]["id"].as_str().unwrap().to_string()]
    );
}

#[test]
fn le_righe_si_scrivono_com_e() {
    // Caratteri che le facce di Fub non hanno: il disegno usa il ripiego.
    let elem = elem_aggiunto(&clic(DISEGNO, Some("漢字 🙂 <&>"), (20.0, 20.0)));
    assert_eq!(elem["children"][0]["text"], "漢字 🙂 <&>");
    // Gli spazi come li mostra SVG, i separatori di riga Unicode.
    let elem = elem_aggiunto(&clic(
        DISEGNO,
        Some("  a   b\u{2028}\u{2028}c "),
        (20.0, 20.0),
    ));
    assert_eq!(
        elem["children"],
        json!([
            { "tag": "tspan", "attrs": { "x": "20", "dy": "0" }, "text": "a b" },
            { "tag": "tspan", "attrs": { "x": "20", "dy": "40" }, "text": "\u{a0}" },
            { "tag": "tspan", "attrs": { "x": "20", "dy": "40" }, "text": "c" },
        ])
    );
    // Una riga di 10 000 caratteri.
    let lunga = "x".repeat(10_000);
    let elem = elem_aggiunto(&clic(DISEGNO, Some(&lunga), (20.0, 20.0)));
    assert_eq!(
        elem["children"][0]["text"].as_str().map(str::len),
        Some(10_000)
    );
}

#[test]
fn il_colore_del_gesto_anche_bianco() {
    let (mut d, _) = apri(DISEGNO);
    let mut g = richiesta(
        "text",
        Some("Testo"),
        vec![evento("down", 20.0, 20.0), evento("up", 20.0, 20.0)],
    );
    g["style"]["stroke"] = json!("#ffffff");
    let elem = elem_aggiunto(&d.gesto(gesto(g)).expect("il gesto"));
    assert_eq!(elem["attrs"]["fill"], "#ffffff");
}

#[test]
fn griglia_e_trascinamento() {
    let (mut d, _) = apri(DISEGNO);
    let mut g = richiesta(
        "text",
        Some("Testo"),
        vec![evento("down", 103.0, 77.0), evento("up", 103.0, 77.0)],
    );
    g["snap"]["grid"] = json!(20);
    let elem = elem_aggiunto(&d.gesto(gesto(g)).expect("il gesto"));
    assert_eq!(
        (&elem["attrs"]["x"], &elem["attrs"]["y"]),
        (&json!("100"), &json!("80"))
    );
    // Un trascinamento non fa un testo in un'area: il testo resta alla
    // pressione, e Maiusc non lo fa verticale.
    let (mut d, _) = apri(DISEGNO);
    let mut eventi = vec![
        evento("down", 20.0, 20.0),
        evento("drag", 120.0, 90.0),
        evento("up", 120.0, 90.0),
    ];
    eventi.iter_mut().for_each(|e| e["shift"] = json!(true));
    let elem = elem_aggiunto(
        &d.gesto(gesto(richiesta("text", Some("Testo"), eventi)))
            .expect("il gesto"),
    );
    assert_eq!(
        (&elem["attrs"]["x"], &elem["attrs"]["y"]),
        (&json!("20"), &json!("20"))
    );
    assert!(elem["attrs"].get("writing-mode").is_none());
}

#[test]
fn livello_bloccato() {
    let chiuso = DISEGNO.replace(
        "fub:layer=\"Livello 1\"",
        "fub:layer=\"Livello 1\" fub:locked=\"true\"",
    );
    let esito = clic(&chiuso, Some("Testo"), (20.0, 20.0));
    assert_eq!(
        (esito.ops, esito.refused),
        (None, Some(DrawingRefusal::Locked))
    );
}

#[test]
fn un_testo_preserve_si_sposta_senza_toccarne_il_contenuto() {
    let (mut d, _) = apri(DISEGNO);
    let mut g = richiesta(
        "select",
        None,
        vec![
            evento("down", 60.0, 230.0),
            evento("drag", 80.0, 250.0),
            evento("up", 80.0, 250.0),
        ],
    );
    g["selection"] = json!(["ot1t1t1t1"]);
    let esito = d.gesto(gesto(g)).expect("il gesto");
    assert_eq!(esito.refused, None);
    let ops = ops_di(&esito);
    let testo = ops.to_string();
    assert!(testo.contains("ot1t1t1t1"), "{testo}");
    assert!(testo.contains("transform"), "{testo}");
    for no in ["\"text\"", "tspan", "Ciao", "xml:space"] {
        assert!(!testo.contains(no), "{no} in {testo}");
    }
}

/// Un comando del motore sui testi `scelti`; un errore ferma la prova.
fn comando(d: &mut Disegno, id: &str, scelti: &[&str], valore: Value) -> DrawingOutcome {
    d.comando(fub_abi::DrawingCommandRequest {
        revision: d.revisione(),
        id: format!("disegno.{id}"),
        selection: scelti.iter().map(|s| (*s).to_string()).collect(),
        value: valore,
        preview: false,
    })
    .unwrap_or_else(|e| panic!("{id}: {e:?}"))
}

/// Prepara la famiglia `testo` del motore, come il client prima delle sue
/// voci: nasce in sottofondo, e si chiede finché non è pronta.
fn prepara_testo(d: &mut Disegno) {
    let inizio = std::time::Instant::now();
    loop {
        let preparata = d
            .comando(fub_abi::DrawingCommandRequest {
                revision: d.revisione(),
                id: fub_abi::DRAWING_COMMAND_FAMILY_PREPARE.into(),
                selection: Vec::new(),
                value: json!({ "famiglia": "testo" }),
                preview: false,
            })
            .expect("la preparazione");
        assert_eq!(preparata.refused, None, "{preparata:?}");
        let stato = preparata.reading.as_ref().map(|l| l["stato"].clone());
        if stato == Some(json!("pronta")) {
            return;
        }
        assert!(
            inizio.elapsed().as_secs() < 30,
            "la famiglia non è pronta: {stato:?}"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
}

/// Grassetto e Corsivo del menu Testo (il client, `completo/facce-testo.ts`)
/// leggono le facce della famiglia con `text.fontList` e mandano
/// `text.setRangeStyle {style}`: col motore vero e le facce di Inter che Fub
/// porta, la lettura è servita e la faccia nuova diventa `font-weight` e
/// `font-style` del `<text>`.
#[test]
fn grassetto_e_corsivo_passano_alle_facce_della_famiglia() {
    let svg = include_str!("famiglie/testo/base.svg");
    let (mut d, _) = apri(svg);
    prepara_testo(&mut d);
    let lista = comando(
        &mut d,
        "text.fontList",
        &["ot1t1t1t1"],
        json!({"family": "Inter"}),
    )
    .reading
    .expect("le facce di Inter");
    let stili: Vec<&str> = lista["styles"]
        .as_array()
        .expect("styles")
        .iter()
        .filter_map(Value::as_str)
        .collect();
    for faccia in ["Regular", "Bold", "Italic", "Bold Italic"] {
        assert!(stili.contains(&faccia), "{faccia} in {stili:?}");
    }
    let esito = comando(
        &mut d,
        "text.setRangeStyle",
        &["ot1t1t1t1"],
        json!({"style": "Bold"}),
    );
    assert_eq!(esito.refused, None);
    let ops = ops_di(&esito).to_string();
    assert!(
        ops.contains(r#""font-weight":"bold""#) || ops.contains(r#""font-weight":"700""#),
        "{ops}"
    );
    let esito = comando(
        &mut d,
        "text.setRangeStyle",
        &["ot1t1t1t1"],
        json!({"style": "Bold Italic"}),
    );
    assert_eq!(esito.refused, None);
    let ops = ops_di(&esito).to_string();
    assert!(ops.contains(r#""font-style":"italic""#), "{ops}");
}

/// Le operazioni di `esito` scritte nel testo `testo`, e il testo nuovo al
/// disegno, come fa il client dopo un comando.
fn sincronizza(d: &mut Disegno, testo: &mut String, esito: &DrawingOutcome) {
    *testo = common::applica::applica(testo, &ops_di(esito)).expect("le operazioni si applicano");
    let sync = fub_abi::DrawingSync {
        revision: d.revisione() + 1,
        change: fub_abi::DrawingChange::Text {
            text: testo.clone(),
        },
    };
    d.sincronizza(sync).expect("il sync passa");
    assert!(
        d.aspetta_il_reimport(std::time::Duration::from_secs(30)),
        "il reimport finisce"
    );
}

/// Trova carattere… del menu Testo (il client, `completo/trova-carattere.ts`)
/// legge i caratteri del disegno (`text.fonts`) e le famiglie
/// (`text.fontList`), e manda `text.replaceFont` (Cambia, sui soli testi
/// scelti; Cambia tutto) e `select.font` (Trova). Col motore vero e le facce
/// di Inter: Inter Regular passa a Inter Bold nel `font-weight` del `<text>`,
/// e un carattere che non c'è è un errore con il perché.
#[test]
fn trova_carattere_sostituisce_e_sceglie_i_testi() {
    let mut svg = include_str!("famiglie/testo/base.svg").to_string();
    let (mut d, _) = apri(&svg);
    prepara_testo(&mut d);
    let caratteri = comando(&mut d, "text.fonts", &[], json!({}))
        .reading
        .expect("i caratteri del disegno");
    let primo = caratteri.as_array().expect("un elenco")[0].clone();
    assert_eq!(primo["family"], "Inter", "{caratteri}");
    assert_eq!(primo["objects"], 2, "{caratteri}");
    let famiglie = comando(&mut d, "text.fontList", &[], json!({}))
        .reading
        .expect("le famiglie");
    assert!(
        famiglie["families"]
            .as_array()
            .is_some_and(|f| f.contains(&json!("Inter"))),
        "{famiglie}"
    );
    // Cambia: solo il testo scelto.
    let solo = comando(
        &mut d,
        "text.replaceFont",
        &["ot2t2t2t2"],
        json!({
            "from": {"family": "Inter", "style": primo["style"]},
            "to": {"family": "Inter", "style": "Bold"},
            "selectionOnly": true
        }),
    );
    assert_eq!(solo.refused, None, "{solo:?}");
    let ops = ops_di(&solo).to_string();
    assert!(ops.contains("ot2t2t2t2"), "{ops}");
    assert!(!ops.contains("ot1t1t1t1"), "{ops}");
    assert!(
        ops.contains(r#""font-weight":"bold""#) || ops.contains(r#""font-weight":"700""#),
        "{ops}"
    );
    sincronizza(&mut d, &mut svg, &solo);
    // Cambia tutto, poi Trova sul carattere nuovo.
    let tutti = comando(
        &mut d,
        "text.replaceFont",
        &[],
        json!({
            "from": {"family": "Inter", "style": primo["style"]},
            "to": {"family": "Inter", "style": "Italic"}
        }),
    );
    assert_eq!(tutti.refused, None, "{tutti:?}");
    let ops = ops_di(&tutti).to_string();
    assert!(ops.contains("ot1t1t1t1"), "{ops}");
    assert!(!ops.contains("ot2t2t2t2"), "{ops}");
    sincronizza(&mut d, &mut svg, &tutti);
    let trovati = comando(
        &mut d,
        "select.font",
        &[],
        json!({"family": "Inter", "style": "Italic"}),
    );
    assert_eq!(trovati.refused, None, "{trovati:?}");
    assert_eq!(
        trovati.selection,
        vec!["ot1t1t1t1".to_string()],
        "{trovati:?}"
    );
    // Un carattere che non c'è: l'errore del motore, e niente cambia.
    let errore = d.comando(fub_abi::DrawingCommandRequest {
        revision: d.revisione(),
        id: "disegno.text.replaceFont".into(),
        selection: Vec::new(),
        value: json!({"from": {"family": "Inter"}, "to": {"family": "Nessuno"}}),
        preview: false,
    });
    assert!(errore.is_err(), "{errore:?}");
}
