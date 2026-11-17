//! Ciò che le prove di `fub-disegno` hanno in comune: un motore su servizi
//! suoi, i vettori dei gesti (`apps/client/src/__fixtures__/disegno-gesti/`,
//! scritti dal client) e il confronto delle operazioni.
//!
//! [`confronta_ops`] guarda il significato, non la scrittura: gli id nuovi
//! diventano `@1`, `@2`… nell'ordine in cui compaiono; i numeri negli
//! attributi si confrontano con tolleranza 1e-3, le `transform` come matrici
//! con tolleranza 1e-6. Un vettore il cui esito può differire per un motivo
//! scritto sta in un `.tsv` di differenze ammesse (`vettore<TAB>perché`).
#![allow(dead_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fub_disegno::motore::{Disegni, Disegno};
use fub_motori::{Caratteri, Config, Generiche, Servizi, Tetto};
use serde_json::Value;

/// La radice del repository.
pub fn radice() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Un motore del disegno su servizi suoi, con caratteri vuoti (il motore
/// disegna i testi con il suo ripiego).
pub fn disegni() -> Arc<Disegni> {
    let servizi = Servizi::nuovi(Config {
        fili: Some(2),
        tetto: Tetto::fisso(256 * 1024 * 1024),
    });
    let generiche = Generiche {
        serif: "Serif".into(),
        sans: "Sans".into(),
        mono: "Mono".into(),
    };
    servizi
        .fornisci_caratteri(Caratteri::nuovi([], generiche))
        .unwrap_or_else(|_| panic!("i caratteri si danno una volta sola"));
    Disegni::nuovi(servizi)
}

/// Apre `testo` su un motore nuovo.
pub fn apri(testo: &str) -> (Disegno, fub_abi::DrawingOpen) {
    Disegno::apri_con(&disegni(), testo).unwrap_or_else(|e| panic!("il disegno non si apre: {e}"))
}

/// Un vettore dei gesti.
#[derive(Clone, Debug)]
pub struct Vettore {
    pub nome: String,
    pub input: String,
    pub gesto: Value,
    /// `expect.ops`: `null` o un elenco di operazioni.
    pub ops: Value,
    pub selezione: Vec<String>,
    pub rifiuto: Option<String>,
}

/// Tutti i vettori, in ordine di nome.
pub fn vettori() -> Vec<Vettore> {
    let dir = radice().join("apps/client/src/__fixtures__/disegno-gesti");
    let mut file: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    file.sort();
    file.iter()
        .map(|p| {
            let v: Value =
                serde_json::from_str(&std::fs::read_to_string(p).expect("leggo il vettore"))
                    .expect("JSON");
            let expect = &v["expect"];
            Vettore {
                nome: v["name"].as_str().unwrap_or_default().to_string(),
                input: v["input"].as_str().unwrap_or_default().to_string(),
                gesto: v["gesture"].clone(),
                ops: expect["ops"].clone(),
                selezione: expect["selection"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|s| s.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default(),
                rifiuto: expect["refused"].as_str().map(str::to_string),
            }
        })
        .collect()
}

/// Le differenze ammesse di un `.tsv`: vettore → perché. Le righe vuote e
/// quelle che cominciano con `#` non contano; un file che manca è vuoto.
pub fn ammesse(percorso: &Path) -> HashMap<String, String> {
    let Ok(testo) = std::fs::read_to_string(percorso) else {
        return HashMap::new();
    };
    testo
        .lines()
        .filter(|r| !r.trim().is_empty() && !r.starts_with('#'))
        .filter_map(|r| r.split_once('\t'))
        .map(|(v, perche)| (v.trim().to_string(), perche.trim().to_string()))
        .collect()
}

/// L'esito di un confronto.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Confronto {
    Uguali,
    /// Diverse, ma il vettore è fra le differenze ammesse.
    Ammessa(String),
    Diverse(String),
}

/// Confronta le operazioni attese (con gli id nuovi già scritti `@n`) e
/// quelle ottenute; `ammessa` è il perché, se il vettore può differire.
pub fn confronta_ops(attese: &Value, ottenute: &Value, ammessa: Option<&str>) -> Confronto {
    let mut a = attese.clone();
    let mut o = ottenute.clone();
    canonicalizza(&mut a);
    canonicalizza(&mut o);
    match uguali(&a, &o, "") {
        Ok(()) => Confronto::Uguali,
        Err(dove) => match ammessa {
            Some(perche) => Confronto::Ammessa(format!("{dove} ({perche})")),
            None => Confronto::Diverse(format!("{dove}\n attese:  {a}\n ottenute: {o}")),
        },
    }
}

/// Gli id nuovi (quelli dati da `ident` e dagli `add`) diventano `@1`,
/// `@2`… nell'ordine in cui compaiono.
fn canonicalizza(ops: &mut Value) {
    let mut nuovi: Vec<String> = Vec::new();
    fn raccogli(v: &Value, nuovi: &mut Vec<String>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| raccogli(x, nuovi)),
            Value::Object(o) => {
                let id = match o.get("op").and_then(Value::as_str) {
                    Some("ident") => o.get("id").and_then(Value::as_str),
                    Some("add") => o.get("elem").and_then(|e| e["attrs"]["id"].as_str()),
                    _ => None,
                };
                if let Some(id) = id {
                    if !nuovi.iter().any(|n| n == id) {
                        nuovi.push(id.to_string());
                    }
                }
                o.values().for_each(|x| raccogli(x, nuovi));
            }
            _ => {}
        }
    }
    raccogli(ops, &mut nuovi);
    let mappa: HashMap<String, String> = nuovi
        .iter()
        .enumerate()
        .map(|(i, id)| (id.clone(), format!("@{}", i + 1)))
        .collect();
    fn rinomina(v: &mut Value, mappa: &HashMap<String, String>) {
        match v {
            Value::String(s) => {
                if let Some(n) = mappa.get(s.as_str()) {
                    *s = n.clone();
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| rinomina(x, mappa)),
            Value::Object(o) => o.values_mut().for_each(|x| rinomina(x, mappa)),
            _ => {}
        }
    }
    rinomina(ops, &mappa);
}

fn matrice(s: &str) -> Option<[f64; 6]> {
    let dentro = s.trim().strip_prefix("matrix(")?.strip_suffix(')')?;
    let n: Vec<f64> = dentro
        .split([' ', ','])
        .filter(|t| !t.is_empty())
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    n.try_into().ok()
}

/// I numeri e le lettere di un attributo (`d`, `fub:geom`, una lista).
fn pezzi(s: &str) -> Vec<Result<f64, String>> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let fine = |cur: &mut String, out: &mut Vec<Result<f64, String>>| {
        if !cur.is_empty() {
            out.push(cur.parse::<f64>().map_err(|_| cur.clone()));
            cur.clear();
        }
    };
    for c in s.chars() {
        if c.is_ascii_digit()
            || c == '.'
            || (c == '-' && cur.is_empty())
            || (c == 'e' && !cur.is_empty() && cur.parse::<f64>().is_ok())
        {
            cur.push(c);
        } else if c == '-' {
            fine(&mut cur, &mut out);
            cur.push(c);
        } else if c.is_whitespace() || c == ',' {
            fine(&mut cur, &mut out);
        } else {
            fine(&mut cur, &mut out);
            out.push(Err(c.to_string()));
        }
    }
    fine(&mut cur, &mut out);
    out
}

fn uguali(a: &Value, o: &Value, dove: &str) -> Result<(), String> {
    match (a, o) {
        (Value::String(x), Value::String(y)) => {
            if x == y {
                return Ok(());
            }
            if let (Some(m), Some(n)) = (matrice(x), matrice(y)) {
                return if m.iter().zip(n).all(|(p, q)| (p - q).abs() <= 1e-6) {
                    Ok(())
                } else {
                    Err(format!("{dove}: matrici diverse {x} ≠ {y}"))
                };
            }
            let (px, py) = (pezzi(x), pezzi(y));
            let numerici = px.iter().any(Result::is_ok);
            if numerici
                && px.len() == py.len()
                && px.iter().zip(&py).all(|(p, q)| match (p, q) {
                    (Ok(p), Ok(q)) => (p - q).abs() <= 1e-3,
                    (Err(p), Err(q)) => p == q,
                    _ => false,
                })
            {
                return Ok(());
            }
            Err(format!("{dove}: «{x}» ≠ «{y}»"))
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Err(format!("{dove}: {} elementi ≠ {}", x.len(), y.len()));
            }
            x.iter()
                .zip(y)
                .enumerate()
                .try_for_each(|(i, (p, q))| uguali(p, q, &format!("{dove}[{i}]")))
        }
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys().chain(y.keys()) {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => uguali(p, q, &format!("{dove}.{k}"))?,
                    _ => return Err(format!("{dove}.{k}: c'è da una parte sola")),
                }
            }
            Ok(())
        }
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(p), Some(q)) if (p - q).abs() <= 1e-3 => Ok(()),
            _ => Err(format!("{dove}: {x} ≠ {y}")),
        },
        _ if a == o => Ok(()),
        _ => Err(format!("{dove}: {a} ≠ {o}")),
    }
}

/// Le operazioni di un esito come JSON (`null` se non ce ne sono).
pub fn ops_di(esito: &fub_abi::DrawingOutcome) -> Value {
    esito.ops.as_deref().map_or(Value::Null, |t| {
        serde_json::from_str(t).expect("ops in JSON")
    })
}

#[cfg(test)]
mod prove {
    use super::*;
    use serde_json::json;

    #[test]
    fn id_nuovi_e_tolleranze() {
        let attese = json!([{ "op": "batch", "ops": [
            { "op": "ident", "path": [2, 0], "tag": "rect", "id": "@1" },
            { "op": "set", "id": "@1", "attrs": { "transform": "matrix(1 0 0 1 20 10)", "d": "M1 2 L3 4" } }
        ]}]);
        let ottenute = json!([{ "op": "batch", "ops": [
            { "op": "ident", "path": [2, 0], "tag": "rect", "id": "oabcdefgh" },
            { "op": "set", "id": "oabcdefgh", "attrs": { "transform": "matrix(1 0 0 1 20.0000001 10)", "d": "M1.0004 2 L3 4" } }
        ]}]);
        assert_eq!(confronta_ops(&attese, &ottenute, None), Confronto::Uguali);
        let diverse =
            json!([{ "op": "set", "id": "x", "attrs": { "transform": "matrix(1 0 0 1 21 10)" } }]);
        assert!(matches!(
            confronta_ops(&attese, &diverse, None),
            Confronto::Diverse(_)
        ));
        assert!(matches!(
            confronta_ops(&attese, &diverse, Some("prova")),
            Confronto::Ammessa(_)
        ));
    }
}
