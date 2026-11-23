//! Un applicatore piccolo delle operazioni della scena sul testo, solo per
//! le forme che la differenza scrive nelle prove (`batch`, `remove` per id o
//! del blocco delle ricette, `add` di `raw` o `elem` coi figli, `move`, `set`,
//! `ident`): il motore delle operazioni vero è quello del client
//! (`apps/client/src/editors/spatial/completo/casi.test.ts` lo prova sugli
//! stessi casi, byte per byte).
//!
//! Serve alle prove della ricetta e al banco delle righe, che con lui
//! disegna ciò che Fub scrive davvero sul disco.

use fub_scene::Item;
use serde_json::Value;

/// Gli elementi del formato di `testo`.
pub fn elementi(testo: &str) -> Result<Vec<fub_scene::ElementItem>, String> {
    Ok(fub_scene::read(testo)
        .map_err(|e| format!("il testo non si legge: {e:?}"))?
        .items
        .into_iter()
        .filter_map(|i| match i {
            Item::Element(e) => Some(*e),
            _ => None,
        })
        .collect())
}

/// Il tratto dell'elemento con l'id `id`.
pub fn span_dell_id(testo: &str, id: &str) -> Result<[usize; 2], String> {
    elementi(testo)?
        .into_iter()
        .find(|e| e.id.as_deref() == Some(id))
        .map(|e| e.span.bytes)
        .ok_or_else(|| format!("l'id {id} non c'è"))
}

/// Dove finisce il tag che comincia in `da`.
pub fn fine_del_tag(testo: &str, da: usize) -> Result<usize, String> {
    testo[da..]
        .find('>')
        .map(|i| da + i + 1)
        .ok_or_else(|| "un tag non chiuso".to_string())
}

/// Dove comincia e finisce il contenuto del genitore.
fn dentro(testo: &str, genitore: &str) -> Result<(usize, usize), String> {
    let [da, a] = if genitore == "#root" {
        let da = testo.find("<svg").ok_or("la radice non c'è")?;
        let a = testo.rfind("</svg>").ok_or("la radice non si chiude")? + "</svg>".len();
        [da, a]
    } else {
        span_dell_id(testo, genitore)?
    };
    let chiude = testo[..a].rfind("</").ok_or("il genitore non si chiude")?;
    let mut inizio = fine_del_tag(testo, da)?;
    if genitore == "#root" {
        // Come il client: il primo posto della radice è dopo il titolo.
        if let Some(t) = testo[inizio..].find("</title>") {
            inizio += t + "</title>".len();
        }
    }
    Ok((inizio, chiude))
}

fn testo_di<'a>(v: &'a Value, cosa: &str) -> Result<&'a str, String> {
    v.as_str()
        .ok_or_else(|| format!("{cosa} non è un testo: {v}"))
}

fn applica_op(testo: &mut String, op: &Value) -> Result<(), String> {
    match testo_di(&op["op"], "op")? {
        "batch" => {
            for o in op["ops"].as_array().ok_or("un batch senza ops")? {
                applica_op(testo, o)?;
            }
        }
        "remove" => {
            let t = &op["target"];
            let [da, a] = match t.as_str() {
                Some(id) => span_dell_id(testo, id)?,
                None => {
                    let percorso: Vec<usize> = serde_json::from_value(t["path"].clone())
                        .map_err(|e| format!("un percorso che non si legge: {e}"))?;
                    if t["tag"] != "metadata" {
                        return Err(format!(
                            "l'applicatore toglie per percorso solo i metadati: {op}"
                        ));
                    }
                    let m = vectorcraft_svg::recipes(testo)
                        .into_iter()
                        .find(|r| r.metadata_path == percorso)
                        .ok_or("il blocco delle ricette non c'è")?;
                    [m.metadata.start, m.metadata.end]
                }
            };
            testo.replace_range(da..a, "");
        }
        "add" => {
            let corpo = match op.get("raw") {
                Some(raw) => testo_di(raw, "raw")?.to_string(),
                None => scrivi_elem(&op["elem"])?,
            };
            inserisci(testo, op, &corpo)?;
        }
        "move" => {
            // L'elemento con i suoi byte, tolto e rimesso dove dice `pos`.
            let id = testo_di(&op["target"], "target")?;
            let [da, a] = span_dell_id(testo, id)?;
            let corpo = testo[da..a].to_string();
            testo.replace_range(da..a, "");
            inserisci(testo, op, &corpo)?;
        }
        "set" => {
            let id = testo_di(&op["id"], "id")?;
            for (k, v) in op["attrs"].as_object().ok_or("un set senza attrs")? {
                if v.is_null() {
                    // Come il client: `null` toglie l'attributo.
                    togli(testo, id, k)?;
                } else {
                    imposta(testo, id, k, testo_di(v, k)?)?;
                }
            }
        }
        "ident" => {
            let percorso: Vec<usize> = serde_json::from_value(op["path"].clone())
                .map_err(|e| format!("un percorso che non si legge: {e}"))?;
            let e = elementi(testo)?
                .into_iter()
                .find(|e| e.path == percorso)
                .ok_or_else(|| format!("nessun elemento in {percorso:?}"))?;
            let at = e.span.bytes[0] + 1 + e.tag.len();
            testo.insert_str(at, &format!(" id=\"{}\"", testo_di(&op["id"], "id")?));
        }
        altro => return Err(format!("l'applicatore non sa {altro}")),
    }
    Ok(())
}

/// Il testo di un `elem`, coi suoi figli.
fn scrivi_elem(e: &Value) -> Result<String, String> {
    let tag = testo_di(&e["tag"], "tag")?;
    let mut s = format!("<{tag}");
    for (k, v) in e["attrs"].as_object().ok_or("un elem senza attrs")? {
        s.push_str(&format!(" {k}=\"{}\"", testo_di(v, k)?));
    }
    // Le parole di una riga (`text`, come lo strumento Testo le scrive).
    let parole = e.get("text").and_then(Value::as_str).unwrap_or("");
    match e.get("children").and_then(Value::as_array) {
        Some(figli) if !figli.is_empty() => {
            s.push('>');
            s.push_str(&scappa(parole));
            for f in figli {
                s.push_str(&scrivi_elem(f)?);
            }
            s.push_str(&format!("</{tag}>"));
        }
        _ if !parole.is_empty() => s.push_str(&format!(">{}</{tag}>", scappa(parole))),
        _ => s.push_str("/>"),
    }
    Ok(s)
}

/// Il testo di un nodo XML con `&`, `<` e `>` sciolti in entità.
fn scappa(testo: &str) -> String {
    testo
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Mette `corpo` sotto `parent`, al posto `pos` dell'operazione `op`. Un
/// genitore vuoto (`<g …/>`) si apre.
fn inserisci(testo: &mut String, op: &Value, corpo: &str) -> Result<(), String> {
    let genitore = testo_di(&op["parent"], "parent")?;
    if genitore != "#root" {
        let [da, _] = span_dell_id(testo, genitore)?;
        let fine = fine_del_tag(testo, da)?;
        if testo[..fine].ends_with("/>") {
            let tag: String = testo[da + 1..]
                .chars()
                .take_while(|c| !c.is_whitespace() && *c != '/' && *c != '>')
                .collect();
            testo.replace_range(fine - 2..fine, &format!("></{tag}>"));
        }
    }
    let (inizio, fine) = dentro(testo, genitore)?;
    let pos = &op["pos"];
    let dove = if pos.get("first").is_some() {
        inizio
    } else if pos.get("last").is_some() {
        fine
    } else {
        span_dell_id(testo, testo_di(&pos["after"], "after")?)?[1]
    };
    testo.insert_str(dove, corpo);
    Ok(())
}

fn imposta(testo: &mut String, id: &str, k: &str, v: &str) -> Result<(), String> {
    let [da, _] = span_dell_id(testo, id)?;
    let fine = fine_del_tag(testo, da)?;
    let tag = &testo[da..fine];
    let chiave = format!(" {k}=\"");
    if let Some(i) = tag.find(&chiave) {
        let inizio = da + i + chiave.len();
        let fine_v = inizio + testo[inizio..].find('"').ok_or("un valore non chiuso")?;
        testo.replace_range(inizio..fine_v, v);
    } else {
        let at = da + tag.find([' ', '/', '>']).ok_or("un tag senza nome")?;
        testo.insert_str(at, &format!(" {k}=\"{v}\""));
    }
    Ok(())
}

fn togli(testo: &mut String, id: &str, k: &str) -> Result<(), String> {
    let [da, _] = span_dell_id(testo, id)?;
    let fine = fine_del_tag(testo, da)?;
    let chiave = format!(" {k}=\"");
    if let Some(i) = testo[da..fine].find(&chiave) {
        let inizio = da + i;
        let valore = inizio + chiave.len();
        let chiude = valore + testo[valore..].find('"').ok_or("un valore non chiuso")?;
        testo.replace_range(inizio..=chiude, "");
    }
    Ok(())
}

/// `testo` con le operazioni `ops` (una lista) applicate in ordine.
pub fn applica(testo: &str, ops: &Value) -> Result<String, String> {
    let mut fuori = testo.to_string();
    for op in ops.as_array().ok_or("le operazioni non sono una lista")? {
        applica_op(&mut fuori, op)?;
    }
    Ok(fuori)
}

/// Le operazioni piatte: quelle del primo `batch`, o la lista com'è.
pub fn piatte(ops: &Value) -> Vec<Value> {
    let lista = ops.as_array().cloned().unwrap_or_default();
    match lista.first() {
        Some(b) if b["op"] == "batch" => b["ops"].as_array().cloned().unwrap_or_default(),
        _ => lista,
    }
}
