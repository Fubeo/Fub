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
    let facce: [&'static [u8]; 2] = [
        include_bytes!("../../fub-features/fonts/inter-400.ttf"),
        include_bytes!("../../fub-features/fonts/inter-700.ttf"),
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
