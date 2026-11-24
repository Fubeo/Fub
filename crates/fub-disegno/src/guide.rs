//! Le guide del righello nel motore (la famiglia `tavole`;
//! `docs/reference/scene-format-rulers.md`, §2).
//!
//! All'apertura le guide di `fub:guides` diventano le guide del motore, nello
//! stesso ordine: la posizione portata nel documento del motore con la matrice
//! della radice, la tavola (`board=`) e il livello (`layer=`) dall'id del file
//! alla tavola e al livello del motore. Un riferimento che non nomina una
//! tavola o un livello del disegno si legge come se mancasse.
//!
//! Dopo un gesto, se le guide del motore sono cambiate, tornano un `set` di
//! `fub:guides` sulla radice, con l'elenco intero nella forma canonica (o
//! senza l'attributo, se non ne resta nessuna). Una guida che non cambia si
//! riscrive come era nel file, coi suoi riferimenti.
//!
//! VectorCraft blocca le guide tutte insieme, per la sessione (Blocca guide);
//! il file di Fub ha un blocco per guida (`locked`). Una guida bloccata del
//! file resta bloccata: non si sposta, non cambia livello e non si toglie da
//! sola (il gesto che lo farebbe si rifiuta), ma se ne va con la sua tavola o
//! col suo livello, e con Cancella guide, che le toglie tutte.
//!
//! Con un valore fuori grammatica, o con una radice ruotata o inclinata (una
//! guida non resterebbe dritta), il motore non ha guide e il gesto che ne
//! aggiungerebbe si rifiuta: il valore del file resta com'è.

use fub_scene::rulers::{parse_guides, Axis, Guide as GuidaDelFile};
use fub_scene::Item;
use serde_json::{json, Value};
use vectorcraft_doc::{Document, Guide, Node, NodeId};
use vectorcraft_geom::Affine;

use crate::apertura::{attributi, valore};
use crate::differenza::numero;
use crate::mappa::Mappa;
use crate::tavole::Tavole;

/// I decimali di una posizione: quelli della geometria.
const DECIMALI: usize = 2;

/// Le guide del file, com'erano all'apertura.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct GuideAperte {
    /// Le guide del file, nell'ordine: la guida `i` del motore all'apertura
    /// viene dalla guida `i` del file.
    pub del_file: Vec<GuidaDelFile>,
    /// Perché le guide non si cambiano: `fub:guides` fuori grammatica, una
    /// radice ruotata o inclinata.
    pub ferme: Option<&'static str>,
}

impl GuideAperte {
    /// Vero se la guida `i` del motore, alla sua apertura, è bloccata nel file.
    pub fn bloccata(&self, i: usize) -> bool {
        self.del_file.get(i).is_some_and(|g| g.locked)
    }
}

/// Una radice che non tiene dritte le guide: ruotata o inclinata.
fn storta(radice: Affine) -> bool {
    let [a, b, c, d, _, _] = radice.as_coeffs();
    b.abs() > 1e-12 || c.abs() > 1e-12 || a.abs() < 1e-12 || d.abs() < 1e-12
}

/// Dalla posizione nel file a quella nel motore.
pub(crate) fn nel_motore(radice: Affine, verticale: bool, at: f64) -> f64 {
    let [a, _, _, d, e, f] = radice.as_coeffs();
    if verticale {
        a * at + e
    } else {
        d * at + f
    }
}

/// Dalla posizione nel motore a quella nel file.
pub(crate) fn nel_file(radice: Affine, verticale: bool, pos: f64) -> f64 {
    let [a, _, _, d, e, f] = radice.as_coeffs();
    if verticale {
        (pos - e) / a
    } else {
        (pos - f) / d
    }
}

/// Il livello del motore che ha l'id del file `id`, se è un livello.
pub(crate) fn livello_del_file(mappa: &Mappa, doc: &Document, id: &str) -> Option<NodeId> {
    let nodo = mappa.elemento(mappa.dell_id(id)?)?.nodo?;
    doc.node(nodo).is_some_and(Node::is_layer).then_some(nodo)
}

/// Legge le guide della radice e le mette nel motore.
pub(crate) fn leggi(
    testo: &str,
    items: &[Item],
    radice: Affine,
    mappa: &Mappa,
    tavole: &Tavole,
    doc: &mut Document,
) -> GuideAperte {
    let mut g = GuideAperte::default();
    doc.guides.clear();
    let valore_del_file = items.iter().find_map(|item| match item {
        Item::Root(r) => attributi(testo, r.span.bytes[0])
            .and_then(|(_, a)| valore(&a, "fub:guides").map(str::to_string)),
        _ => None,
    });
    let Some(v) = valore_del_file else {
        return g;
    };
    let Some(del_file) = parse_guides(&v) else {
        g.ferme = Some("le guide del file sono fuori grammatica: non cambiano");
        return g;
    };
    if del_file.is_empty() {
        return g;
    }
    if storta(radice) {
        g.ferme = Some("il disegno è ruotato o inclinato: le guide non cambiano");
        return g;
    }
    for d in &del_file {
        let verticale = d.axis == Axis::X;
        let artboard = d
            .board
            .as_deref()
            .and_then(|b| tavole.del_file.iter().find(|t| t.id == b).map(|t| t.motore));
        let layer = d
            .layer
            .as_deref()
            .and_then(|l| livello_del_file(mappa, doc, l));
        doc.guides.push(Guide {
            artboard,
            layer,
            ..Guide::new(verticale, nel_motore(radice, verticale, d.at))
        });
    }
    // Come all'apertura nel motore: una guida senza livello va sul primo
    // livello visibile e sbloccato, così la copia e il motore hanno le stesse
    // guide. Finché non cambia, la guida si riscrive com'era nel file.
    doc.adopt_guides();
    g.del_file = del_file;
    g
}

fn vicini(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6 * (1.0 + a.abs().max(b.abs()))
}

fn uguali(a: &Guide, b: &Guide) -> bool {
    a.vertical == b.vertical
        && a.artboard == b.artboard
        && a.layer == b.layer
        && vicini(a.pos, b.pos)
}

/// Quanto la tavola `id` si è spostata lungo l'asse della guida fra `prima`
/// e `poi`, se c'è ancora.
fn spostamento(prima: &Document, poi: &Document, id: u32, verticale: bool) -> Option<f64> {
    let p = prima.artboards.iter().find(|a| a.id == id)?.rect;
    let q = poi.artboards.iter().find(|a| a.id == id)?.rect;
    Some(if verticale { q.x0 - p.x0 } else { q.y0 - p.y0 })
}

/// Perché le guide non si scrivono.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NonSiScrive {
    /// Il file le tiene ferme ([`GuideAperte::ferme`]).
    Ferme(&'static str),
    /// Il gesto sposta, cambia di livello o toglie una guida bloccata.
    Bloccata,
}

/// Il `set` di `fub:guides` sulla radice, se le guide sono cambiate fra
/// `prima` (la copia) e `poi`. `tavola` dà l'id del file di una tavola del
/// motore, `livello` quello di un livello.
pub(crate) fn operazione(
    g: &GuideAperte,
    prima: &Document,
    poi: &Document,
    radice: Affine,
    tavola: &dyn Fn(u32) -> Option<String>,
    livello: &dyn Fn(NodeId) -> Option<String>,
) -> Result<Option<Value>, NonSiScrive> {
    let (a, b) = (&prima.guides, &poi.guides);
    if a.len() == b.len() && a.iter().zip(b).all(|(x, y)| uguali(x, y)) {
        return Ok(None);
    }
    if let Some(motivo) = g.ferme {
        return Err(NonSiScrive::Ferme(motivo));
    }
    // Ogni guida di dopo, legata alla guida del file da cui viene: prima le
    // uguali, poi quelle che si sono spostate con la loro tavola.
    let mut legata: Vec<Option<usize>> = vec![None; b.len()];
    let mut presa = vec![false; a.len()];
    for (j, y) in b.iter().enumerate() {
        if let Some(i) = (0..a.len()).find(|&i| !presa[i] && uguali(&a[i], y)) {
            presa[i] = true;
            legata[j] = Some(i);
        }
    }
    for (j, y) in b.iter().enumerate() {
        if legata[j].is_some() {
            continue;
        }
        let Some(t) = y.artboard else { continue };
        let Some(dx) = spostamento(prima, poi, t, y.vertical) else {
            continue;
        };
        if dx.abs() < 1e-9 {
            continue;
        }
        let mossa = |x: &Guide| Guide {
            pos: x.pos + dx,
            ..x.clone()
        };
        if let Some(i) = (0..a.len()).find(|&i| !presa[i] && uguali(&mossa(&a[i]), y)) {
            presa[i] = true;
            legata[j] = Some(i);
        }
    }
    // Una guida bloccata che manca dopo se ne va solo con la sua tavola, col
    // suo livello o con tutte le altre (Cancella guide).
    if !b.is_empty() {
        for (i, x) in a.iter().enumerate() {
            if presa[i] || !g.bloccata(i) {
                continue;
            }
            let tavola_via = x
                .artboard
                .is_some_and(|t| !poi.artboards.iter().any(|q| q.id == t));
            let livello_via = x.layer.is_some_and(|l| poi.node(l).is_none());
            if !(tavola_via || livello_via) {
                return Err(NonSiScrive::Bloccata);
            }
        }
    }
    let mut parti = Vec::with_capacity(b.len());
    for (j, y) in b.iter().enumerate() {
        let del_file = legata[j].and_then(|i| g.del_file.get(i));
        // Una guida uguale si riscrive com'era, coi riferimenti del file.
        if let (Some(d), Some(i)) = (del_file, legata[j]) {
            if uguali(&a[i], y) {
                parti.push(scrivi(d));
                continue;
            }
        }
        let verticale = y.vertical;
        let at = nel_file(radice, verticale, y.pos);
        let at = numero(at, DECIMALI).parse::<f64>().unwrap_or(at);
        parti.push(scrivi(&GuidaDelFile {
            axis: if verticale { Axis::X } else { Axis::Y },
            at,
            locked: del_file.is_some_and(|d| d.locked),
            board: y.artboard.and_then(tavola),
            layer: y.layer.and_then(livello),
        }));
    }
    let valore = if parti.is_empty() {
        Value::Null
    } else {
        json!(parti.join("; "))
    };
    Ok(Some(
        json!({ "op": "set", "id": "#root", "attrs": { "fub:guides": valore } }),
    ))
}

/// Una guida nella forma canonica: asse, numero, tavola, livello, blocco.
fn scrivi(g: &GuidaDelFile) -> String {
    let mut s = format!(
        "{} {}",
        if g.axis == Axis::X { "x" } else { "y" },
        numero(g.at, DECIMALI)
    );
    if let Some(b) = &g.board {
        s.push_str(" board=");
        s.push_str(b);
    }
    if let Some(l) = &g.layer {
        s.push_str(" layer=");
        s.push_str(l);
    }
    if g.locked {
        s.push_str(" locked");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_forma_canonica() {
        let g = GuidaDelFile {
            axis: Axis::Y,
            at: 340.5,
            locked: true,
            board: Some("b1".into()),
            layer: Some("l2".into()),
        };
        assert_eq!(scrivi(&g), "y 340.5 board=b1 layer=l2 locked");
        let g = GuidaDelFile {
            axis: Axis::X,
            at: -0.0,
            locked: false,
            board: None,
            layer: None,
        };
        assert_eq!(scrivi(&g), "x 0");
    }

    #[test]
    fn la_posizione_va_e_torna_con_la_radice() {
        let radice = Affine::new([0.75, 0.0, 0.0, 0.75, 10.0, -4.0]);
        let x = nel_motore(radice, true, 120.0);
        assert!((nel_file(radice, true, x) - 120.0).abs() < 1e-9);
        let y = nel_motore(radice, false, 8.0);
        assert!((nel_file(radice, false, y) - 8.0).abs() < 1e-9);
        assert!(storta(Affine::rotate(0.3)));
        assert!(!storta(radice));
    }
}
