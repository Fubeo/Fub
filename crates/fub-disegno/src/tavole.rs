//! Le tavole del disegno nel motore (K6, lo strumento Tavola e i comandi
//! `artboard.*`; `docs/reference/scene-format-boards.md`).
//!
//! All'apertura le tavole del file (`view` con `fub:role="board"`)
//! diventano le tavole del motore, nello stesso ordine, col loro nome e il
//! loro rettangolo portato nel documento del motore. Un disegno senza tavole
//! ha nel motore la tavola che l'import fa della pagina, come un file nuovo
//! di VectorCraft.
//!
//! Dopo un gesto le tavole del motore tornano operazioni sul file, legate
//! per l'id del motore a quelle di prima:
//!
//! - una tavola tolta perde il suo `view` e la sua carta;
//! - una tavola spostata o ridimensionata cambia il `viewBox` e la carta con
//!   lui, con gli stessi quattro numeri;
//! - una tavola rinominata si toglie e si rimette al suo posto col nome
//!   nuovo e lo stesso id (un `view` senza id non sarebbe più una tavola);
//! - una tavola nuova ha un `view` nuovo e una carta nuova, col colore della
//!   carta della pagina o della prima tavola, dopo l'ultima carta;
//! - nel disegno senza tavole, la pagina diventa la prima tavola quando il
//!   motore la cambia o ne aggiunge un'altra: la carta della pagina riceve
//!   `fub:board` e diventa la sua carta;
//! - l'ordine delle tavole è quello del motore;
//! - se una tavola esce dalla pagina, la pagina si allarga a passi di 256
//!   unità con `page`, per ultima, come per un oggetto.
//!
//! I nomi che il motore dà alle tavole nuove (`Artboard 2`) si scrivono in
//! italiano (`Tavola 2`).

use std::collections::{HashMap, HashSet};

use fub_scene::{Item, Role};
use serde_json::{json, Value};
use vectorcraft_doc::{Artboard, Document};
use vectorcraft_geom::{Affine, Rect};

use crate::apertura::{attributi, leggi_view_box, valore};
use crate::differenza::numero;
use crate::id::Specie;

/// I passi con cui la pagina si allarga, come per un oggetto.
const PASSO_PAGINA: f64 = 256.0;

/// I decimali dei numeri di una tavola: quelli della geometria.
const DECIMALI: usize = 2;

/// Una tavola del file.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TavolaDelFile {
    /// L'id del `view`.
    pub id: String,
    /// L'id della sua carta, se ne ha una con un id.
    pub carta: Option<String>,
    /// L'id della tavola nel motore.
    pub motore: u32,
}

/// Le tavole del file e ciò che serve per scriverne di nuove.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Tavole {
    /// Le tavole del file, nell'ordine.
    pub del_file: Vec<TavolaDelFile>,
    /// La carta della pagina (senza `fub:board`), se ha un id.
    pub carta_della_pagina: Option<String>,
    /// La geometria della carta della pagina, `x y w h`.
    pub geometria_della_carta: Option<[f64; 4]>,
    /// Il colore delle carte nuove: quello della carta della pagina o della
    /// prima tavola.
    pub colore: Option<String>,
    /// L'ultima carta fra i figli della radice: le carte nuove vanno dopo.
    pub ultima_carta: Option<String>,
    /// Il `viewBox` della radice.
    pub pagina: Option<[f64; 4]>,
    /// Le carte che non si possono scrivere (un id che manca, un `fub:board`
    /// che non va): allora le tavole non cambiano.
    pub fuori_regola: bool,
}

/// Legge le tavole del file e, se ce ne sono, le mette nel motore.
pub(crate) fn leggi(testo: &str, items: &[Item], base: Affine, doc: &mut Document) -> Tavole {
    let mut t = Tavole::default();
    let mut viste: Vec<(String, Option<String>, [f64; 4])> = Vec::new();
    let mut carte: Vec<(Option<String>, Option<String>)> = Vec::new();
    for item in items {
        match item {
            Item::Root(r) => {
                if let Some((_, a)) = attributi(testo, r.span.bytes[0]) {
                    t.pagina = valore(&a, "viewBox").and_then(leggi_view_box);
                }
            }
            Item::Element(e) if e.path.len() == 1 => match e.role {
                Role::Board => {
                    if let (Some(id), Some(scatola)) = (&e.id, e.board_box) {
                        viste.push((id.clone(), e.title.clone(), scatola));
                    }
                }
                Role::Paper => {
                    let attr = attributi(testo, e.span.bytes[0])
                        .map(|(_, a)| a)
                        .unwrap_or_default();
                    let colore = valore(&attr, "fill").map(str::to_string);
                    if e.board.is_none() {
                        let n =
                            |k: &str| valore(&attr, k).and_then(|v| v.trim().parse::<f64>().ok());
                        if let (Some(x), Some(y), Some(w), Some(h)) =
                            (n("x"), n("y"), n("width"), n("height"))
                        {
                            t.geometria_della_carta = Some([x, y, w, h]);
                        }
                    }
                    if t.colore.is_none() {
                        t.colore = colore;
                    }
                    if e.id.is_none() {
                        t.fuori_regola = true;
                    }
                    t.ultima_carta = e.id.clone().or(t.ultima_carta.take());
                    carte.push((e.id.clone(), e.board.clone()));
                }
                _ => {}
            },
            _ => {}
        }
    }
    if viste.is_empty() {
        t.carta_della_pagina = carte
            .iter()
            .find(|c| c.1.is_none())
            .and_then(|c| c.0.clone());
        if carte.iter().any(|c| c.1.is_some()) || carte.len() > 1 {
            t.fuori_regola = true;
        }
        if doc.artboards.len() != 1 {
            t.fuori_regola = true;
        }
        return t;
    }
    let ids: HashSet<&str> = viste.iter().map(|v| v.0.as_str()).collect();
    let mut usate: HashSet<String> = HashSet::new();
    for (id, tavola) in &carte {
        match tavola {
            Some(b) if ids.contains(b.as_str()) && usate.insert(b.clone()) => {}
            _ => t.fuori_regola = true,
        }
        if id.is_none() {
            t.fuori_regola = true;
        }
    }
    let modello = doc
        .artboards
        .first()
        .cloned()
        .unwrap_or_else(|| Document::new(1.0, 1.0).artboards[0].clone());
    doc.artboards.clear();
    for (i, (id, nome, scatola)) in viste.into_iter().enumerate() {
        let motore = u32::try_from(i + 1).unwrap_or(u32::MAX);
        let carta = carte
            .iter()
            .find(|c| c.1.as_deref() == Some(id.as_str()))
            .and_then(|c| c.0.clone());
        let [x, y, w, h] = scatola;
        let rect = base.transform_rect_bbox(Rect::new(x, y, x + w, y + h));
        doc.artboards.push(Artboard {
            id: motore,
            name: nome_nel_motore(
                &nome
                    .filter(|n| !n.trim().is_empty())
                    .unwrap_or_else(|| id.clone()),
            ),
            rect,
            ..modello.clone()
        });
        t.del_file.push(TavolaDelFile { id, carta, motore });
    }
    t
}

/// Il nome di una tavola nel file: quelli che il motore dà alle tavole nuove
/// (`Artboard 3`) e alle copie (`Retro copy`, `Retro copy 2`) in italiano
/// (`Tavola 3`, `Retro copia`, `Retro copia 2`). [`nome_nel_motore`] fa il
/// contrario all'apertura, così il motore riconosce i suoi nomi e non ne dà
/// uno che il disegno ha già.
pub(crate) fn nome_nel_file(nome: &str) -> String {
    traduci(nome, "Artboard ", " copy", "Tavola ", " copia")
}

/// Il nome di una tavola del file nel motore: il contrario di
/// [`nome_nel_file`].
pub(crate) fn nome_nel_motore(nome: &str) -> String {
    traduci(nome, "Tavola ", " copia", "Artboard ", " copy")
}

/// `nome` con il numero `da_numero N` scritto `a_numero N` e il suffisso
/// `da_copia` (o `da_copia N`) scritto `a_copia`.
fn traduci(nome: &str, da_numero: &str, da_copia: &str, a_numero: &str, a_copia: &str) -> String {
    let cifre = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let (base, coda) = match nome.rfind(da_copia) {
        Some(i) => {
            let dopo = &nome[i + da_copia.len()..];
            match dopo.strip_prefix(' ') {
                _ if dopo.is_empty() => (&nome[..i], a_copia.to_string()),
                Some(n) if cifre(n) => (&nome[..i], format!("{a_copia} {n}")),
                _ => (nome, String::new()),
            }
        }
        None => (nome, String::new()),
    };
    let base = match base.strip_prefix(da_numero) {
        Some(n) if cifre(n) => format!("{a_numero}{n}"),
        _ => base.to_string(),
    };
    format!("{base}{coda}")
}

fn vicini(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6
}

fn rect_vicini(a: Rect, b: Rect) -> bool {
    vicini(a.x0, b.x0) && vicini(a.y0, b.y0) && vicini(a.x1, b.x1) && vicini(a.y1, b.y1)
}

/// Le tavole del motore sono quelle di prima: stessi id, nomi, rettangoli e
/// ordine.
fn uguali(prima: &[Artboard], poi: &[Artboard]) -> bool {
    prima.len() == poi.len()
        && prima
            .iter()
            .zip(poi)
            .all(|(a, b)| a.id == b.id && a.name == b.name && rect_vicini(a.rect, b.rect))
}

/// Perché le tavole non si scrivono.
#[derive(Debug, PartialEq)]
pub(crate) enum NonSiScrive {
    /// Le carte del file non vanno con le tavole (S015), o una non ha id.
    FuoriRegola,
    /// Nessun id nuovo libero.
    Id,
    /// La matrice della radice non si inverte.
    Matrice,
}

/// Le operazioni che portano le tavole del file a quelle del motore `poi`.
pub(crate) fn operazioni(
    t: &Tavole,
    prima: &[Artboard],
    poi: &[Artboard],
    radice: Affine,
    id_nuovo: &mut dyn FnMut(Specie) -> Option<String>,
) -> Result<Vec<Value>, NonSiScrive> {
    if uguali(prima, poi) {
        return Ok(Vec::new());
    }
    if t.fuori_regola {
        return Err(NonSiScrive::FuoriRegola);
    }
    if radice.determinant().abs() < 1e-12 {
        return Err(NonSiScrive::Matrice);
    }
    let inversa = radice.inverse();
    let scatola = |a: &Artboard| -> [f64; 4] {
        let r = inversa.transform_rect_bbox(a.rect);
        let arrotonda = |v: f64| numero(v, DECIMALI).parse::<f64>().unwrap_or(v);
        let (x0, y0, x1, y1) = (
            arrotonda(r.x0),
            arrotonda(r.y0),
            arrotonda(r.x1),
            arrotonda(r.y1),
        );
        [x0, y0, x1 - x0, y1 - y0]
    };
    let testo = |s: [f64; 4]| -> [String; 4] { s.map(|v| numero(v, DECIMALI)) };
    let prima_per_id: HashMap<u32, &Artboard> = prima.iter().map(|a| (a.id, a)).collect();
    let mut del_file: HashMap<u32, (String, Option<String>)> = t
        .del_file
        .iter()
        .map(|d| (d.motore, (d.id.clone(), d.carta.clone())))
        .collect();
    let restano: HashSet<u32> = poi.iter().map(|a| a.id).collect();
    let mut ops: Vec<Value> = Vec::new();

    // Le tavole tolte, con le loro carte.
    for d in &t.del_file {
        if !restano.contains(&d.motore) {
            ops.push(json!({ "op": "remove", "target": d.id }));
            if let Some(c) = &d.carta {
                ops.push(json!({ "op": "remove", "target": c }));
            }
        }
    }
    // L'ordine dei `view` com'è nel file mentre le operazioni lo cambiano.
    let mut ordine: Vec<String> = t
        .del_file
        .iter()
        .filter(|d| restano.contains(&d.motore))
        .map(|d| d.id.clone())
        .collect();
    let mut ultima_carta = t.ultima_carta.clone();
    // La carta della pagina che diventa della prima tavola che ne ha bisogno.
    let mut carta_libera = t.carta_della_pagina.clone();
    let vista = |id: &str, nome: &str, s: &[String; 4]| -> Value {
        json!({
            "tag": "view",
            "attrs": { "id": id, "fub:role": "board", "viewBox": s.join(" ") },
            "children": [ { "tag": "title", "attrs": {}, "text": nome_nel_file(nome) } ]
        })
    };
    let mut precedente: Option<String> = None;
    let mut fuori: Option<Rect> = None;
    for a in poi {
        let s = scatola(a);
        let st = testo(s);
        let r = Rect::new(s[0], s[1], s[0] + s[2], s[1] + s[3]);
        fuori = Some(fuori.map_or(r, |f| f.union(r)));
        let pos = match &precedente {
            Some(p) => json!({ "after": p }),
            None => json!({ "first": true }),
        };
        if let Some((id, carta)) = del_file.remove(&a.id) {
            let vecchia = prima_per_id.get(&a.id).copied();
            let nome_cambiato = vecchia.is_some_and(|v| v.name != a.name);
            let mossa = vecchia.is_some_and(|v| !rect_vicini(v.rect, a.rect));
            if nome_cambiato {
                ops.push(json!({ "op": "remove", "target": id }));
                ordine.retain(|o| *o != id);
                ops.push(json!({ "op": "add", "parent": "#root", "pos": pos, "elem": vista(&id, &a.name, &st) }));
                inserisci(&mut ordine, precedente.as_deref(), &id);
            } else {
                if mossa {
                    ops.push(
                        json!({ "op": "set", "id": id, "attrs": { "viewBox": st.join(" ") } }),
                    );
                }
                if !al_suo_posto(&ordine, precedente.as_deref(), &id) {
                    ops.push(json!({ "op": "move", "target": id, "parent": "#root", "pos": pos }));
                    ordine.retain(|o| *o != id);
                    inserisci(&mut ordine, precedente.as_deref(), &id);
                }
            }
            if mossa {
                if let Some(c) = carta {
                    ops.push(json!({ "op": "set", "id": c, "attrs": {
                        "x": st[0], "y": st[1], "width": st[2], "height": st[3] } }));
                }
            }
            precedente = Some(id);
            continue;
        }
        // Una tavola nuova, o la pagina che diventa la prima tavola.
        let id = id_nuovo(Specie::Tavola).ok_or(NonSiScrive::Id)?;
        ops.push(
            json!({ "op": "add", "parent": "#root", "pos": pos, "elem": vista(&id, &a.name, &st) }),
        );
        inserisci(&mut ordine, precedente.as_deref(), &id);
        if let Some(c) = carta_libera.take() {
            ops.push(json!({ "op": "set", "id": c, "attrs": { "fub:board": id } }));
            let stessa = t
                .geometria_della_carta
                .is_some_and(|g| g.iter().zip(&s).all(|(a, b)| vicini(*a, *b)));
            if !stessa {
                ops.push(json!({ "op": "set", "id": c, "attrs": {
                    "x": st[0], "y": st[1], "width": st[2], "height": st[3] } }));
            }
        } else if ultima_carta.is_some() {
            let c = id_nuovo(Specie::Carta).ok_or(NonSiScrive::Id)?;
            let mut attrs = serde_json::Map::new();
            attrs.insert("id".into(), json!(c));
            attrs.insert("fub:role".into(), json!("paper"));
            attrs.insert("fub:board".into(), json!(id));
            for (k, v) in ["x", "y", "width", "height"].into_iter().zip(&st) {
                attrs.insert(k.into(), json!(v));
            }
            if let Some(colore) = &t.colore {
                attrs.insert("fill".into(), json!(colore));
            }
            let pos_carta = match &ultima_carta {
                Some(u) => json!({ "after": u }),
                None => json!({ "first": true }),
            };
            ops.push(json!({ "op": "add", "parent": "#root", "pos": pos_carta,
                "elem": { "tag": "rect", "attrs": Value::Object(attrs) } }));
            ultima_carta = Some(c);
        }
        precedente = Some(id);
    }
    // La pagina copre le tavole.
    if let (Some(p), Some(f)) = (t.pagina, fuori) {
        if let Some(vb) = pagina_allargata(p, f) {
            ops.push(json!({ "op": "page", "viewBox": vb }));
        }
    }
    Ok(ops)
}

/// `id` sta subito dopo `precedente` fra i `view` (o per primo).
fn al_suo_posto(ordine: &[String], precedente: Option<&str>, id: &str) -> bool {
    let Some(i) = ordine.iter().position(|o| o == id) else {
        return false;
    };
    match precedente {
        None => i == 0,
        Some(p) => i > 0 && ordine[i - 1] == p,
    }
}

fn inserisci(ordine: &mut Vec<String>, precedente: Option<&str>, id: &str) {
    let at = precedente
        .and_then(|p| ordine.iter().position(|o| o == p))
        .map_or(0, |i| i + 1);
    ordine.insert(at, id.to_string());
}

/// Il `viewBox` della pagina allargata a passi finché copre `f`; `None` se
/// lo copre già.
fn pagina_allargata(p: [f64; 4], f: Rect) -> Option<String> {
    let passi = |fuori: f64| {
        if fuori > 1e-9 {
            (fuori / PASSO_PAGINA).ceil() * PASSO_PAGINA
        } else {
            0.0
        }
    };
    let sinistra = passi(p[0] - f.x0);
    let sopra = passi(p[1] - f.y0);
    let destra = passi(f.x1 - (p[0] + p[2]));
    let sotto = passi(f.y1 - (p[1] + p[3]));
    if sinistra + sopra + destra + sotto == 0.0 {
        return None;
    }
    let x = p[0] - sinistra;
    let y = p[1] - sopra;
    let w = p[2] + sinistra + destra;
    let h = p[3] + sopra + sotto;
    Some([x, y, w, h].map(|v| numero(v, DECIMALI)).join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tavola(id: u32, nome: &str, r: Rect) -> Artboard {
        Artboard {
            id,
            name: nome.into(),
            rect: r,
            ..Document::new(1.0, 1.0).artboards[0].clone()
        }
    }

    #[test]
    fn i_nomi_del_motore_si_scrivono_in_italiano() {
        assert_eq!(nome_nel_file("Artboard 3"), "Tavola 3");
        assert_eq!(nome_nel_file("Artboard"), "Artboard");
        assert_eq!(nome_nel_file("Copertina"), "Copertina");
        assert_eq!(nome_nel_file("Retro copy"), "Retro copia");
        assert_eq!(nome_nel_file("Retro copy 2"), "Retro copia 2");
        assert_eq!(nome_nel_file("Artboard 2 copy"), "Tavola 2 copia");
        assert_eq!(nome_nel_file("Retro copy due"), "Retro copy due");
        assert_eq!(nome_nel_file(" copy"), " copia");
    }

    #[test]
    fn i_nomi_tornano_al_motore_uguali() {
        for nome in [
            "Artboard 3",
            "Retro copy",
            "Retro copy 2",
            "Artboard 2 copy",
            "Copertina",
            "Foto copiatrice",
        ] {
            assert_eq!(nome_nel_motore(&nome_nel_file(nome)), nome);
        }
        assert_eq!(nome_nel_motore("Tavola 4"), "Artboard 4");
        assert_eq!(nome_nel_motore("Tavola"), "Tavola");
    }

    #[test]
    fn la_pagina_si_allarga_a_passi() {
        assert_eq!(
            pagina_allargata([0.0, 0.0, 400.0, 300.0], Rect::new(10.0, 10.0, 20.0, 20.0)),
            None
        );
        assert_eq!(
            pagina_allargata(
                [0.0, 0.0, 400.0, 300.0],
                Rect::new(450.0, 0.0, 700.0, 100.0)
            )
            .as_deref(),
            Some("0 0 912 300")
        );
    }

    #[test]
    fn la_pagina_diventa_la_prima_tavola_quando_ne_nasce_un_altra() {
        let t = Tavole {
            carta_della_pagina: Some("fub-paper".into()),
            colore: Some("#ffffff".into()),
            ultima_carta: Some("fub-paper".into()),
            pagina: Some([0.0, 0.0, 400.0, 300.0]),
            ..Tavole::default()
        };
        let prima = [tavola(1, "Artboard 1", Rect::new(0.0, 0.0, 400.0, 300.0))];
        let poi = [
            prima[0].clone(),
            tavola(2, "Artboard 2", Rect::new(500.0, 0.0, 600.0, 100.0)),
        ];
        let mut n = 0;
        let ops = operazioni(&t, &prima, &poi, Affine::IDENTITY, &mut |s| {
            n += 1;
            Some(format!("{}0000000{n}", s.prefisso()))
        })
        .unwrap();
        let testo = serde_json::to_string(&ops).unwrap();
        assert!(testo.contains(r#""fub:board":"b00000001""#), "{testo}");
        assert!(testo.contains(r#""text":"Tavola 1""#), "{testo}");
        assert!(testo.contains(r#""text":"Tavola 2""#), "{testo}");
        assert!(testo.contains(r#""id":"c00000003""#), "{testo}");
        assert_eq!(ops.last().unwrap()["op"], "page", "{testo}");
    }

    #[test]
    fn una_tavola_spostata_porta_la_sua_carta() {
        let t = Tavole {
            del_file: vec![TavolaDelFile {
                id: "b1".into(),
                carta: Some("c1".into()),
                motore: 1,
            }],
            pagina: Some([0.0, 0.0, 400.0, 300.0]),
            ..Tavole::default()
        };
        let prima = [tavola(1, "Uno", Rect::new(0.0, 0.0, 100.0, 100.0))];
        let poi = [tavola(1, "Uno", Rect::new(10.0, 20.0, 110.0, 120.0))];
        let ops = operazioni(&t, &prima, &poi, Affine::IDENTITY, &mut |_| None).unwrap();
        assert_eq!(
            ops,
            vec![
                json!({ "op": "set", "id": "b1", "attrs": { "viewBox": "10 20 100 100" } }),
                json!({ "op": "set", "id": "c1", "attrs": { "x": "10", "y": "20", "width": "100", "height": "100" } }),
            ]
        );
        assert_eq!(
            operazioni(&t, &prima, &prima, Affine::IDENTITY, &mut |_| None),
            Ok(Vec::new())
        );
    }
}
