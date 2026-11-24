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
//! - **Il livello che ritaglia** (`layer.clippingMask.toggle`): un livello
//!   o un gruppo che c'era già comincia a ritagliare col suo oggetto più
//!   alto, che il motore mette in fondo. Nel file l'oggetto esce ed entra in
//!   un `clipPath` privato come sopra, nelle coordinate del livello, e il
//!   livello riceve `clip-path` con un `set`; premuto di nuovo, è un
//!   Rilascia.
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
use crate::mappa::{Elemento, Posti};
use std::collections::HashSet;
use std::sync::Arc;

/// Gli attributi della geometria che un pezzo di ritaglio tiene: il resto
/// (colori, contorno) un `clipPath` non lo usa.
const GEOMETRIA: [&str; 13] = [
    "d", "x", "y", "width", "height", "cx", "cy", "rx", "ry", "x1", "y1", "x2", "y2",
];

/// Il perché di un gesto che toglie la forma legata da una maschera che resta.
const FORMA_TOLTA: &str =
    "il tracciato che ritaglia non esce da solo dalla maschera: usa Rilascia maschera di ritaglio";

/// Un testo che ritaglia: il motore lo sa fare, il file non ancora.
pub(super) const TESTO_CHE_RITAGLIA: &str =
    "un testo che ritaglia non si scrive nel file: in cima ci vuole un tracciato";

impl Lavoro<'_> {
    /// I ritagli fatti o rilasciati dal gesto: il tracciato che ritaglia un
    /// gruppo di ritaglio nuovo esce dal file (va nel `clipPath`, fra gli
    /// [`Lavoro::assorbiti`]); quello di un gruppo rilasciato, che nel file
    /// non era un elemento, entra (fra i [`Lavoro::liberati`]).
    ///
    /// La forma legata di una maschera (`Mappa::lega_i_ritagli`) non lascia
    /// il suo posto se la maschera resta: tolta, o spostata fuori, il motore
    /// farebbe ritagliare l'oggetto dopo, che nel file è un'altra cosa.
    pub(super) fn ritagli(&mut self, prima: &Posti<'_>, poi: &Posti<'_>) -> Result<(), Rifiuto> {
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
                    // Un contenitore di prima che comincia a ritagliare: il
                    // suo primo figlio, di prima, va nel `clipPath`.
                    if !p.nodo.clips() && dopo.nodo.clips() {
                        if let Some(c) = taglierina(dopo.nodo) {
                            let libero = self.elemento(c.id).is_some_and(|e| !e.ritaglia);
                            if prima.nodi.contains_key(&c.id) && libero {
                                self.assorbiti.insert(c.id);
                            }
                        }
                        continue;
                    }
                    if let (Some(c), Some(d)) = (taglierina(p.nodo), taglierina(dopo.nodo)) {
                        let legata = self.elemento(c.id).is_some_and(|e| e.ritaglia);
                        if legata && d.id != c.id {
                            return Err(no(FORMA_TOLTA));
                        }
                    }
                    let rilasciato = p.nodo.clips() && !dopo.nodo.clips();
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
                    // Senza forma nel file, o con la forma legata che esce
                    // dal `clipPath`: torna un oggetto, con un id nuovo.
                    let fuori_dal_file = match self.elemento(c.id) {
                        None => true,
                        Some(e) => e.ritaglia,
                    };
                    if ancora_primo && fuori_dal_file {
                        self.liberati.insert(c.id);
                    }
                }
            }
        }
        Ok(())
    }

    /// La forma legata di una maschera cambiata (Modifica maschera, poi un
    /// gesto su di lei): si riscrive nel suo `clipPath` con un `set` sulla
    /// parte `[0]`, nello spazio del gruppo. Se cambia tipo (un'ellisse che
    /// diventa un tracciato), la parte non lo può dire: la maschera prende un
    /// `clipPath` privato nuovo, e quello di prima se ne va con l'ultimo
    /// riferimento.
    pub(super) fn forma_del_ritaglio(
        &mut self,
        e: &Elemento,
        b: &Node,
        a: &Node,
    ) -> Result<(), Rifiuto> {
        let gruppo = e
            .genitore
            .and_then(|i| self.copia.mappa.elemento(i))
            .cloned()
            .ok_or_else(|| no("la forma che ritaglia senza la sua maschera"))?;
        let risorsa = gruppo
            .ritaglio
            .clone()
            .ok_or_else(|| no("la maschera non nomina il suo clipPath"))?;
        let locale = e
            .ctm_genitore
            .ok_or_else(|| no("la transform della maschera non si legge"))?
            .inverse();
        if !locale.is_finite() {
            return Err(no("la maschera ha una transform che non si inverte"));
        }
        let forma = forma_che_ritaglia(a, locale)?;
        let tag = forma["tag"].as_str().unwrap_or_default();
        let prima = forma_che_ritaglia(b, locale).ok();
        let stessa = prima.as_ref().is_some_and(|p| p == &forma);
        if stessa && e.propria.is_some_and(|t| t == Affine::IDENTITY) {
            return Ok(());
        }
        if tag == e.tag {
            let mut attrs = forma["attrs"].as_object().cloned().unwrap_or_default();
            // La `transform` di prima ora è nella geometria, e la regola di
            // prima se ne va se non serve più.
            if e.propria != Some(Affine::IDENTITY) {
                attrs.insert("transform".into(), Value::Null);
            }
            attrs.entry("clip-rule").or_insert(Value::Null);
            self.set
                .push(json!({ "op": "set", "id": risorsa, "part": [0], "attrs": attrs }));
            return Ok(());
        }
        let id_gruppo = gruppo
            .id
            .clone()
            .ok_or_else(|| no("la maschera non ha un id"))?;
        let mut forma = forma;
        let nuova = self.id_nuovo(Specie::Risorsa)?;
        let id_forma = self.id_nuovo(Specie::Risorsa)?;
        forma["attrs"]["id"] = json!(id_forma);
        self.ids.insert(a.id, id_forma);
        self.sfumature.push(json!({
            "tag": "clipPath",
            "attrs": { "id": nuova, "fub:role": "private", "clipPathUnits": "userSpaceOnUse" },
            "children": [forma],
        }));
        self.set.push(json!({ "op": "set", "id": id_gruppo, "attrs": { "clip-path": format!("url(#{nuova})") } }));
        Ok(())
    }

    /// Un gruppo o un livello di prima che smette di ritagliare (Rilascia):
    /// il `set` che toglie `clip-path`, e il contenitore di prima come se non
    /// ritagliasse, per il resto del confronto. `None` se il cambio è un altro.
    pub(super) fn ritaglio_tolto(&mut self, b: &Node, a: &Node) -> Result<Option<Node>, Rifiuto> {
        if !b.clips() || a.clips() || a.children().is_none() {
            return Ok(None);
        }
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
        sciolto.set_clips(false);
        Ok(Some(sciolto))
    }

    /// Un gruppo o un livello di prima che comincia a ritagliare col suo
    /// oggetto più alto (il livello che ritaglia): il `clipPath` privato con
    /// la forma, che [`Lavoro::ritagli`] ha tolto dal file, e il `set` di
    /// `clip-path` sul contenitore; il contenitore di prima come se
    /// ritagliasse, per il resto del confronto. `None` se il cambio è un altro.
    pub(super) fn ritaglio_messo(&mut self, b: &Node, a: &Node) -> Result<Option<Node>, Rifiuto> {
        if b.clips() || !a.clips() {
            return Ok(None);
        }
        let c = taglierina(a).ok_or_else(|| no("un ritaglio senza la forma che ritaglia"))?;
        if !self.assorbiti.contains(&c.id) {
            return Err(no(
                "la forma che ritaglia non è un oggetto di Fub di quel livello",
            ));
        }
        let e = self
            .elemento(a.id)
            .cloned()
            .ok_or_else(|| no("il livello che ritaglia non viene da Fub"))?;
        if e.clip_path {
            return Err(no("il livello ha già un clip-path che il motore non legge"));
        }
        let locale = e
            .ctm()
            .ok_or_else(|| no("la transform del livello non si legge"))?
            .inverse();
        if !locale.is_finite() {
            return Err(no("il livello ha una transform che non si inverte"));
        }
        let mut forma = forma_che_ritaglia(c, locale)?;
        let risorsa = self.id_nuovo(Specie::Risorsa)?;
        let id_forma = self.id_nuovo(Specie::Risorsa)?;
        forma["attrs"]["id"] = json!(id_forma);
        self.ids.insert(c.id, id_forma);
        self.sfumature.push(json!({
            "tag": "clipPath",
            "attrs": { "id": risorsa, "fub:role": "private", "clipPathUnits": "userSpaceOnUse" },
            "children": [forma],
        }));
        let id = self.bersaglio(a.id)?;
        self.set.push(
            json!({ "op": "set", "id": id, "attrs": { "clip-path": format!("url(#{risorsa})") } }),
        );
        let mut messo = b.clone();
        messo.set_clips(true);
        Ok(Some(messo))
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
        let mut forma = forma_che_ritaglia(c, locale)?;
        let risorsa = self.id_nuovo(Specie::Risorsa)?;
        // La forma ha un id suo, di risorsa: «Modifica maschera» la sceglie
        // e un suo cambio si scrive sul posto ([`crate::mappa::Mappa::lega_i_ritagli`]).
        let id_forma = self.id_nuovo(Specie::Risorsa)?;
        forma["attrs"]["id"] = json!(id_forma);
        self.ids.insert(c.id, id_forma);
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

/// Il tracciato che ritaglia di un gruppo o di un livello che ritaglia: il
/// primo figlio.
fn taglierina(n: &Node) -> Option<&Arc<Node>> {
    n.clips()
        .then(|| n.children().and_then(|f| f.first()))
        .flatten()
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
            let (tag, attrs) = elem(&senza, locale, &Default::default(), false)?;
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
