//! I gruppi di ritaglio del motore nel file (piano K6, T12; formato della
//! scena, «I ritagli e le maschere»).
//!
//! - **Crea** (`object.clippingMask.make`): il motore mette gli oggetti scelti
//!   in un gruppo di ritaglio nuovo, col più alto per primo come tracciato
//!   che ritaglia. Nel file il tracciato esce come elemento ed entra in un
//!   `clipPath` privato (`fub:role="private"`, `userSpaceOnUse`) nella
//!   `fub-defs`, nelle coordinate del gruppo, senza id e con
//!   `fill="#000000"`; il gruppo è un `<g clip-path="url(#…)">` nuovo dove il
//!   motore lo mette, e gli altri oggetti ci si spostano dentro con un `move`,
//!   come con Raggruppa: restano gli stessi elementi, coi loro byte.
//! - **Rilascia** (`object.clippingMask.release`): il gruppo resta un gruppo
//!   semplice (il `set` toglie `clip-path`) e il tracciato che ritagliava
//!   torna un oggetto del file, primo nel gruppo, con un id nuovo e
//!   `fill="none"`, come lo lascia il motore. Il `clipPath` privato se ne va
//!   con il suo ultimo riferimento; quello di un altro programma, che non
//!   dice di chi è, resta nel file com'è.
//!
//! Un ritaglio che il file non dice con l'attributo `clip-path` (in `style`,
//! o da un foglio di stile) non si toglie con un `set`: Rilascia è
//! `unsupported`. Un testo che ritaglia non si scrive ancora.

use serde_json::{json, Map, Value};
use vectorcraft_doc::{Appearance, Node, NodeId, NodeKind};
use vectorcraft_geom::{Affine, FillRule};

use super::{
    elem, no, proprieta_uguali, scrivi_d, tracciato_composto, trasformato, Lavoro, Rifiuto,
};
use crate::id::Specie;
use crate::mappa::Posti;
use std::collections::HashSet;
use std::sync::Arc;

/// Gli attributi della geometria che un pezzo di ritaglio tiene: il resto
/// (colori, contorno) un `clipPath` non lo usa.
const GEOMETRIA: [&str; 13] = [
    "d", "x", "y", "width", "height", "cx", "cy", "rx", "ry", "x1", "y1", "x2", "y2",
];

/// Un testo che ritaglia: il motore lo sa fare, il file non ancora.
pub(super) const TESTO_CHE_RITAGLIA: &str =
    "un testo che ritaglia non si scrive nel file: in cima ci vuole un tracciato";

impl Lavoro<'_> {
    /// I ritagli fatti o rilasciati dal gesto: il tracciato che ritaglia un
    /// gruppo di ritaglio nuovo esce dal file (va nel `clipPath`, fra gli
    /// [`Lavoro::assorbiti`]); quello di un gruppo rilasciato, che nel file
    /// non era un elemento, entra (fra i [`Lavoro::liberati`]).
    pub(super) fn ritagli(&mut self, prima: &Posti<'_>, poi: &Posti<'_>) {
        for (id, dopo) in &poi.nodi {
            match prima.nodi.get(id) {
                None => {
                    let Some(c) = taglierina(dopo.nodo) else {
                        continue;
                    };
                    let di_prima = prima.nodi.contains_key(&c.id);
                    if di_prima && self.copia.mappa.del_nodo(c.id).is_some() {
                        self.assorbiti.insert(c.id);
                    }
                }
                Some(p) => {
                    let rilasciato = matches!(p.nodo.kind, NodeKind::Group { clip: true, .. })
                        && matches!(dopo.nodo.kind, NodeKind::Group { clip: false, .. });
                    if !rilasciato {
                        continue;
                    }
                    let Some(c) = p.nodo.children().and_then(|f| f.first()) else {
                        continue;
                    };
                    let ancora_primo = dopo
                        .nodo
                        .children()
                        .and_then(|f| f.first())
                        .is_some_and(|d| d.id == c.id);
                    if ancora_primo && self.copia.mappa.del_nodo(c.id).is_none() {
                        self.liberati.insert(c.id);
                    }
                }
            }
        }
    }

    /// Un gruppo di prima che smette di ritagliare (Rilascia): il `set` che
    /// toglie `clip-path`, e il gruppo di prima come se non ritagliasse, per
    /// il resto del confronto. `None` se il cambio è un altro.
    pub(super) fn ritaglio_tolto(&mut self, b: &Node, a: &Node) -> Result<Option<Node>, Rifiuto> {
        let (
            NodeKind::Group {
                children,
                clip: true,
            },
            NodeKind::Group { clip: false, .. },
        ) = (&b.kind, &a.kind)
        else {
            return Ok(None);
        };
        let Some(e) = self.elemento(a.id).cloned() else {
            return Ok(None);
        };
        if !e.clip_path {
            return Err(no(
                "il ritaglio non è scritto con l'attributo clip-path (viene da uno stile): Rilascia non lo toglie",
            ));
        }
        let id = self.bersaglio(a.id)?;
        self.set
            .push(json!({ "op": "set", "id": id, "attrs": { "clip-path": null } }));
        let mut sciolto = b.clone();
        sciolto.kind = NodeKind::Group {
            children: children.clone(),
            clip: false,
        };
        Ok(Some(sciolto))
    }

    /// Scrive il gruppo di ritaglio nuovo `nodo` (vedi [`ritaglio_nuovo`]):
    /// il `clipPath` privato con il tracciato che ritaglia e il `<g>` che lo
    /// usa, al posto `pos` sotto `parent`. `locale` porta dal documento del
    /// motore allo spazio del genitore, che è anche quello del gruppo.
    pub(super) fn scrivi_ritaglio(
        &mut self,
        nodo: &Node,
        genitore: Option<NodeId>,
        parent: String,
        pos: Value,
        locale: Affine,
    ) -> Result<(), Rifiuto> {
        let c = taglierina(nodo).ok_or_else(|| no("un gruppo di ritaglio senza tracciato"))?;
        let forma = forma_che_ritaglia(c, locale)?;
        let risorsa = self.id_nuovo(Specie::Risorsa)?;
        let id = self.id_nuovo(Specie::Oggetto)?;
        self.ids.insert(nodo.id, id.clone());
        self.gruppi_nuovi.insert(nodo.id, genitore);
        self.sfumature.push(json!({
            "tag": "clipPath",
            "attrs": { "id": risorsa, "fub:role": "private", "clipPathUnits": "userSpaceOnUse" },
            "children": [forma],
        }));
        self.add.push(json!({
            "op": "add", "parent": parent, "pos": pos,
            "elem": { "tag": "g", "attrs": { "id": id, "clip-path": format!("url(#{risorsa})") } },
        }));
        Ok(())
    }
}

/// Il tracciato che ritaglia di un gruppo di ritaglio: il primo figlio.
fn taglierina(n: &Node) -> Option<&Arc<Node>> {
    match &n.kind {
        NodeKind::Group {
            children,
            clip: true,
        } => children.first(),
        _ => None,
    }
}

/// Vero per un gruppo di ritaglio nuovo che Crea fa di oggetti di prima: il
/// tracciato che ritaglia è un elemento di Fub che il gesto assorbe, gli
/// altri c'erano già e non si riscrivono, e il gruppo non ha proprietà sue.
pub(super) fn ritaglio_nuovo(
    n: &Node,
    prima: &Posti<'_>,
    assorbiti: &HashSet<NodeId>,
    riscritti: &HashSet<NodeId>,
) -> bool {
    let NodeKind::Group {
        children,
        clip: true,
    } = &n.kind
    else {
        return false;
    };
    children.len() >= 2
        && assorbiti.contains(&children[0].id)
        && children[1..]
            .iter()
            .all(|c| prima.nodi.contains_key(&c.id) && !riscritti.contains(&c.id))
        && proprieta_uguali(
            n,
            &Node::new(
                n.id,
                NodeKind::Group {
                    children: Vec::new(),
                    clip: true,
                },
            ),
        )
}

/// Il pezzo del `clipPath`: la geometria del tracciato che ritaglia nello
/// spazio del gruppo, senza id, con `fill="#000000"` (non aveva più
/// riempimento) e `clip-rule="evenodd"` se la sua regola lo è.
fn forma_che_ritaglia(c: &Node, locale: Affine) -> Result<Value, Rifiuto> {
    let (tag, attrs, regola) = match &c.kind {
        NodeKind::Compound { .. } => {
            let (p, regola) = tracciato_composto(c).ok_or_else(|| {
                no("un tracciato composto che ritaglia con pezzi che non si scrivono")
            })?;
            let mut attrs = Map::new();
            attrs.insert("d".into(), json!(scrivi_d(&trasformato(&p, locale))));
            ("path".to_string(), attrs, regola)
        }
        NodeKind::Path {
            rule, guide: false, ..
        } => {
            let mut senza = c.clone();
            senza.appearance = Appearance::default().into();
            let (tag, attrs) = elem(&senza, locale, &Default::default())?;
            (tag, attrs, *rule)
        }
        NodeKind::Text(_) => return Err(no(TESTO_CHE_RITAGLIA)),
        _ => return Err(no("ritaglia solo un tracciato")),
    };
    let mut attrs: Map<String, Value> = attrs
        .into_iter()
        .filter(|(k, _)| GEOMETRIA.contains(&k.as_str()))
        .collect();
    attrs.insert("fill".into(), json!("#000000"));
    if regola == FillRule::EvenOdd {
        attrs.insert("clip-rule".into(), json!("evenodd"));
    }
    Ok(json!({ "tag": tag, "attrs": attrs }))
}
