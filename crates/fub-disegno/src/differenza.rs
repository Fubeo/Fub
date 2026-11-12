//! La differenza fra la copia com'era all'import e il documento del motore
//! dopo un gesto, scritta come operazioni di scena
//! (`docs/reference/scene-operations.md`) sugli elementi di Fub.
//!
//! Per ogni oggetto toccato si scrive l'operazione più piccola:
//!
//! - **`set`** degli attributi cambiati. Un cambio di posto, misura o
//!   rotazione è una matrice M sul documento del motore: l'elemento riceve
//!   `transform = G⁻¹·M·G·T`, dove T è la sua `transform` e G la matrice dal
//!   suo genitore al documento del motore (la radice compresa). M si trova
//!   dai punti dell'oggetto e si **verifica**: l'oggetto di prima mosso da M
//!   deve essere quello di dopo. Un gruppo mosso tutto insieme riceve la
//!   `transform` lui, non i figli; un livello mai. I colori pieni e lo
//!   spessore diventano `fill`, `stroke`, `stroke-width`; un tracciato
//!   cambiato in un modo che nessuna matrice spiega diventa `d`.
//! - **`add`** per gli oggetti nuovi, con l'`Elem` come lo scrive il client
//!   (`rect`, `ellipse`, `line` o `path`, geometria con due decimali); uno
//!   strumento può scriverlo lui ([`Scrittore`]).
//! - **`remove`** per quelli tolti, **`move`** per l'ordine e il genitore.
//! - **`ident`** prima di tutto, per gli elementi senza id che un'operazione
//!   nomina: un id nuovo del formato di [`crate::id`].
//!
//! Ciò che non si scrive come attributi dell'elemento di prima è un rifiuto
//! `unsupported` (niente riscritture intere); un oggetto che non torna nella
//! mappa è `unmapped`. Oltre [`MAX_DRAWING_OPS`] operazioni o
//! [`MAX_DRAWING_OPS_BYTES`] byte è `too_large`.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use fub_abi::{DrawingRefusal, MAX_DRAWING_OPS, MAX_DRAWING_OPS_BYTES};
use serde_json::{json, Map, Value};
use vectorcraft_doc::color::Paint;
use vectorcraft_doc::{
    Appearance, Document, LineCap, LineJoin, LiveShape, Node, NodeId, NodeKind, Scaling,
};
use vectorcraft_geom::{Affine, Point};

use crate::apertura::Copia;
use crate::id::{self, Specie};
use crate::mappa::{Elemento, Posti};

/// Tolleranza relativa con cui due documenti del motore sono uguali: le
/// matrici composte dagli strumenti e quella ritrovata qui differiscono
/// solo per l'arrotondamento.
const TOLLERANZA: f64 = 1e-6;

/// Decimali della geometria e delle matrici, come le scrive il client.
const DECIMALI_GEOMETRIA: usize = 2;
const DECIMALI_MATRICE: usize = 4;

/// Perché un gesto non diventa operazioni.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rifiuto {
    /// Il cambio non si scrive come attributi dell'elemento di prima.
    NonSupportato(String),
    /// Il gesto tocca un oggetto che non torna nella mappa.
    NonMappato(String),
    /// Le operazioni supererebbero i limiti del contratto.
    TroppoGrande,
}

impl Rifiuto {
    /// Il rifiuto del contratto.
    pub fn rifiuto(&self) -> DrawingRefusal {
        match self {
            Rifiuto::NonSupportato(_) => DrawingRefusal::Unsupported,
            Rifiuto::NonMappato(_) => DrawingRefusal::Unmapped,
            Rifiuto::TroppoGrande => DrawingRefusal::TooLarge,
        }
    }
}

fn no(motivo: impl Into<String>) -> Rifiuto {
    Rifiuto::NonSupportato(motivo.into())
}

/// Chi scrive l'`Elem` di un oggetto nuovo al posto della scrittura comune:
/// riceve l'oggetto e la matrice dal documento del motore allo spazio del
/// genitore, e dà il tag e gli attributi (senza `id`), o `None` per lasciare
/// la scrittura comune.
pub type Scrittore<'a> = &'a dyn Fn(&Node, Affine) -> Option<(String, Map<String, Value>)>;

/// Le operazioni di un gesto.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Differenza {
    /// Le operazioni, nell'ordine in cui si applicano.
    pub ops: Vec<Value>,
    /// Gli id di Fub degli oggetti che non ne avevano uno nel file: i nuovi
    /// e quelli che hanno ricevuto un id con `ident`.
    pub ids: HashMap<NodeId, String>,
}

impl Differenza {
    /// Il testo da mandare: `[op]` per un'operazione sola, `[batch]` per più
    /// d'una, `None` per nessuna.
    pub fn testo(&self) -> Result<Option<String>, Rifiuto> {
        if self.ops.len() > MAX_DRAWING_OPS {
            return Err(Rifiuto::TroppoGrande);
        }
        let lista = match self.ops.len() {
            0 => return Ok(None),
            1 => Value::Array(self.ops.clone()),
            _ => json!([{ "op": "batch", "ops": self.ops }]),
        };
        let testo = serde_json::to_string(&lista)
            .map_err(|e| no(format!("le operazioni non si scrivono: {e}")))?;
        if testo.len() > MAX_DRAWING_OPS_BYTES {
            return Err(Rifiuto::TroppoGrande);
        }
        Ok(Some(testo))
    }
}

/// La differenza fra la copia e `dopo`.
pub(crate) fn differenza(
    copia: &Copia,
    dopo: &Document,
    scrittore: Option<Scrittore<'_>>,
) -> Result<Differenza, Rifiuto> {
    let prima = Posti::di(&copia.documento);
    let poi = Posti::di(dopo);
    let mut lavoro = Lavoro {
        copia,
        scrittore,
        ident: Vec::new(),
        remove: Vec::new(),
        moves: Vec::new(),
        add: Vec::new(),
        set: Vec::new(),
        ids: HashMap::new(),
        dati: HashSet::new(),
    };
    lavoro.tolti(&prima, &poi)?;
    lavoro.ordine(&prima, dopo)?;
    lavoro.nuovi(&prima, dopo)?;
    for l in &dopo.layers {
        let Some(p) = prima.nodi.get(&l.id) else {
            continue;
        };
        lavoro.confronta(p.nodo, l, &prima)?;
    }
    let Lavoro {
        ident,
        mut remove,
        moves,
        add,
        set,
        ids,
        ..
    } = lavoro;
    // I `remove` per percorso: dall'ultimo al primo, così ogni percorso vale
    // ancora quando tocca a lui.
    remove.sort_by(|a, b| b.0.cmp(&a.0));
    let mut ops = ident;
    ops.extend(remove.into_iter().map(|(_, op)| op));
    ops.extend(moves);
    ops.extend(add);
    ops.extend(set);
    if ops.len() > MAX_DRAWING_OPS {
        return Err(Rifiuto::TroppoGrande);
    }
    crate::perdite::controlla(&copia.perdite, &ops).map_err(Rifiuto::NonMappato)?;
    Ok(Differenza { ops, ids })
}

struct Lavoro<'a> {
    copia: &'a Copia,
    scrittore: Option<Scrittore<'a>>,
    ident: Vec<Value>,
    /// Con il percorso dell'elemento tolto, per ordinarli.
    remove: Vec<(Vec<usize>, Value)>,
    moves: Vec<Value>,
    add: Vec<Value>,
    set: Vec<Value>,
    ids: HashMap<NodeId, String>,
    /// Gli id dati in questo gesto.
    dati: HashSet<String>,
}

impl Lavoro<'_> {
    fn elemento(&self, nodo: NodeId) -> Option<&Elemento> {
        self.copia
            .mappa
            .del_nodo(nodo)
            .and_then(|i| self.copia.mappa.elemento(i))
    }

    fn id_nuovo(&mut self, specie: Specie) -> Result<String, Rifiuto> {
        let mappa = &self.copia.mappa;
        let dati = &self.dati;
        let id = id::nuovo(specie, &|id| mappa.id_preso(id) || dati.contains(id))
            .ok_or_else(|| no("nessun id nuovo libero"))?;
        self.dati.insert(id.clone());
        Ok(id)
    }

    /// L'id con cui le operazioni nominano l'oggetto `nodo`: quello del file,
    /// o uno nuovo dato con `ident` (una volta sola per gesto).
    fn bersaglio(&mut self, nodo: NodeId) -> Result<String, Rifiuto> {
        if let Some(id) = self.ids.get(&nodo) {
            return Ok(id.clone());
        }
        let Some(e) = self.elemento(nodo) else {
            return Err(Rifiuto::NonMappato(format!(
                "l'oggetto {} del motore non viene da un elemento di Fub",
                nodo.0
            )));
        };
        if let Some(id) = e.id_del_file() {
            return Ok(id.to_string());
        }
        let (percorso, tag) = (e.percorso.clone(), e.tag);
        let specie = if e.ruolo == fub_scene::Role::Layer {
            Specie::Livello
        } else {
            Specie::Oggetto
        };
        let id = self.id_nuovo(specie)?;
        self.ident
            .push(json!({ "op": "ident", "path": percorso, "tag": tag, "id": id }));
        self.ids.insert(nodo, id.clone());
        Ok(id)
    }

    /// Il genitore come lo scrivono le operazioni: `#root` o un id.
    fn genitore(&mut self, nodo: Option<NodeId>) -> Result<String, Rifiuto> {
        match nodo {
            None => Err(no("un livello nuovo del motore")),
            Some(g) if self.copia.mappa.e_radice(g) => Ok("#root".into()),
            Some(g) => self.bersaglio(g),
        }
    }

    /// Dallo spazio del genitore `nodo` al documento del motore.
    fn matrice_del_genitore(&self, nodo: Option<NodeId>) -> Result<Affine, Rifiuto> {
        match nodo {
            Some(g) if self.copia.mappa.e_radice(g) => Ok(self.copia.radice),
            Some(g) => self
                .elemento(g)
                .ok_or_else(|| {
                    Rifiuto::NonMappato("il genitore non viene da un elemento di Fub".into())
                })?
                .ctm()
                .ok_or_else(|| no("una transform del genitore non si legge")),
            None => Ok(self.copia.radice),
        }
    }

    /// Gli oggetti tolti: un `remove` per il più alto di ognuno.
    fn tolti(&mut self, prima: &Posti<'_>, poi: &Posti<'_>) -> Result<(), Rifiuto> {
        for (id, posto) in &prima.nodi {
            if poi.nodi.contains_key(id) {
                continue;
            }
            if posto.genitore.is_some_and(|g| !poi.nodi.contains_key(&g)) {
                continue;
            }
            if self.copia.mappa.e_radice(*id) {
                return Err(no("il gesto toglie un livello del motore"));
            }
            let Some(e) = self.elemento(*id) else {
                return Err(Rifiuto::NonMappato(format!(
                    "il gesto toglie l'oggetto {} che non viene da Fub",
                    id.0
                )));
            };
            let bersaglio = match e.id_del_file() {
                Some(id) => json!(id),
                None => json!({ "path": e.percorso, "tag": e.tag }),
            };
            self.remove.push((
                e.percorso.clone(),
                json!({ "op": "remove", "target": bersaglio }),
            ));
        }
        Ok(())
    }

    /// L'ordine e il genitore degli oggetti che ci sono prima e dopo: un
    /// `move` per ognuno fuori dalla sottosequenza crescente più lunga dei
    /// fratelli rimasti.
    fn ordine(&mut self, prima: &Posti<'_>, dopo: &Document) -> Result<(), Rifiuto> {
        let mut contenitori: Vec<(Option<NodeId>, &Vec<Arc<Node>>)> = Vec::new();
        fn raccogli<'a>(n: &'a Arc<Node>, out: &mut Vec<(Option<NodeId>, &'a Vec<Arc<Node>>)>) {
            if let Some(figli) = n.children() {
                out.push((Some(n.id), figli));
                for c in figli {
                    raccogli(c, out);
                }
            }
        }
        for l in &dopo.layers {
            raccogli(l, &mut contenitori);
        }
        for (genitore, figli) in contenitori {
            // Solo i figli che c'erano già; i nuovi li mette `add`.
            let rimasti: Vec<&Arc<Node>> = figli
                .iter()
                .filter(|c| prima.nodi.contains_key(&c.id))
                .collect();
            let chiavi: Vec<Option<usize>> = rimasti
                .iter()
                .map(|c| {
                    prima
                        .nodi
                        .get(&c.id)
                        .filter(|p| p.genitore == genitore)
                        .map(|p| p.indice)
                })
                .collect();
            let fermi = sottosequenza_crescente(&chiavi);
            if fermi.len() == rimasti.len() {
                continue;
            }
            for (i, c) in rimasti.iter().enumerate() {
                if fermi.contains(&i) {
                    continue;
                }
                let spostato_di_genitore = chiavi[i].is_none();
                if spostato_di_genitore {
                    let vecchio = prima.nodi.get(&c.id).and_then(|p| p.genitore);
                    let (a, b) = (
                        self.matrice_del_genitore(vecchio)?,
                        self.matrice_del_genitore(genitore)?,
                    );
                    if !matrici_vicine(a, b) {
                        return Err(no(
                            "lo spostamento in un altro gruppo cambierebbe la sua transform",
                        ));
                    }
                }
                let target = self.bersaglio(c.id)?;
                let parent = self.genitore(genitore)?;
                let pos = match i.checked_sub(1).and_then(|j| rimasti.get(j)) {
                    Some(prec) => json!({ "after": self.bersaglio(prec.id)? }),
                    None => json!({ "first": true }),
                };
                self.moves
                    .push(json!({ "op": "move", "target": target, "parent": parent, "pos": pos }));
            }
        }
        Ok(())
    }

    /// Gli oggetti nuovi: un `add` per il più alto di ognuno.
    fn nuovi(&mut self, prima: &Posti<'_>, dopo: &Document) -> Result<(), Rifiuto> {
        // Un oggetto nuovo: il genitore, i fratelli dopo il gesto, il posto.
        type Nuovo<'a> = (Option<NodeId>, Vec<&'a Arc<Node>>, usize);
        let mut nuovi: Vec<Nuovo<'_>> = Vec::new();
        fn cerca<'a>(n: &'a Arc<Node>, prima: &Posti<'_>, out: &mut Vec<Nuovo<'a>>) {
            let Some(figli) = n.children() else { return };
            for (i, c) in figli.iter().enumerate() {
                if prima.nodi.contains_key(&c.id) {
                    cerca(c, prima, out);
                } else {
                    out.push((Some(n.id), figli.iter().collect(), i));
                }
            }
        }
        for l in &dopo.layers {
            if !prima.nodi.contains_key(&l.id) {
                return Err(no("il gesto crea un livello del motore"));
            }
            cerca(l, prima, &mut nuovi);
        }
        for (genitore, fratelli, i) in nuovi {
            let nodo = fratelli[i];
            let parent = self.genitore(genitore)?;
            let locale = self.matrice_del_genitore(genitore)?.inverse();
            if !locale.is_finite() {
                return Err(no("il genitore ha una transform che non si inverte"));
            }
            let id = self.id_nuovo(Specie::Oggetto)?;
            let scritto = self.scrittore.and_then(|s| s(nodo, locale));
            let (tag, mut attrs) = match scritto {
                Some(e) => e,
                None => elem(nodo, locale)?,
            };
            attrs.insert("id".into(), json!(id));
            self.ids.insert(nodo.id, id);
            let pos = if i + 1 == fratelli.len() {
                json!({ "last": true })
            } else {
                match i.checked_sub(1).map(|j| fratelli[j]) {
                    Some(prec) => json!({ "after": self.bersaglio(prec.id)? }),
                    None => json!({ "first": true }),
                }
            };
            self.add.push(json!({ "op": "add", "parent": parent, "pos": pos, "elem": { "tag": tag, "attrs": attrs } }));
        }
        Ok(())
    }

    /// Gli oggetti che ci sono prima e dopo, dall'alto: i `set`.
    fn confronta(
        &mut self,
        b: &Arc<Node>,
        a: &Arc<Node>,
        prima: &Posti<'_>,
    ) -> Result<(), Rifiuto> {
        if Arc::ptr_eq(b, a) || **b == **a {
            return Ok(());
        }
        let radice = self.copia.mappa.e_radice(a.id);
        let livello = matches!(a.kind, NodeKind::Layer { .. })
            || self
                .elemento(a.id)
                .is_some_and(|e| e.ruolo == fub_scene::Role::Layer);
        // Un `<path>` con più sottotracciati (la freccia) è un tracciato
        // composto del motore, i cui figli non sono elementi di Fub: se i
        // figli restano gli stessi, il cambio è suo e si scrive come quello
        // di una foglia.
        if let (NodeKind::Compound { children: fb, .. }, NodeKind::Compound { children: fa, .. }) =
            (&b.kind, &a.kind)
        {
            let stessi = fb.len() == fa.len()
                && fb
                    .iter()
                    .zip(fa)
                    .all(|(x, y)| Arc::ptr_eq(x, y) || **x == **y)
                && fa.iter().all(|c| self.copia.mappa.del_nodo(c.id).is_none());
            if let Some(e) = self
                .elemento(a.id)
                .filter(|e| e.tag == "path" && stessi)
                .cloned()
            {
                let attrs = self.foglia(&e, b, a)?;
                if !attrs.is_empty() {
                    let id = self.bersaglio(a.id)?;
                    self.set
                        .push(json!({ "op": "set", "id": id, "attrs": attrs }));
                }
                return Ok(());
            }
        }
        if let Some(figli) = a.children() {
            // La `transform` va al gruppo quando lo spostamento è di tutto il
            // gruppo e scriverla sui figli non basta o costa di più: un figlio
            // che non viene da Fub, o più d'un figlio. Con un figlio solo di
            // Fub la riceve il figlio, l'oggetto toccato.
            let gruppo = !radice && !livello && self.elemento(a.id).is_some();
            let per_il_gruppo = figli.len() > 1 || figli.iter().any(|c| self.ha_estranei(c));
            if gruppo && per_il_gruppo {
                if let Some(m) = adatta(b, a) {
                    if !vicina_all_identita(m)
                        && mosso_da(b, m, true).is_some_and(|c| nodi_vicini(&c, a))
                    {
                        let e = self
                            .elemento(a.id)
                            .cloned()
                            .ok_or_else(|| no("gruppo senza elemento"))?;
                        let t = nuova_trasformazione(&e, m)?;
                        let id = self.bersaglio(a.id)?;
                        self.set.push(json!({ "op": "set", "id": id, "attrs": { "transform": scrivi_matrice(t) } }));
                        return Ok(());
                    }
                }
            }
            if !proprieta_uguali(b, a) {
                return Err(no(
                    "cambia un gruppo o un livello in un modo che non si scrive",
                ));
            }
            for c in figli {
                let Some(p) = prima.nodi.get(&c.id) else {
                    continue;
                };
                self.confronta(p.nodo, c, prima)?;
            }
            return Ok(());
        }
        if radice || livello {
            return Err(no("cambia un livello"));
        }
        let Some(e) = self.elemento(a.id).cloned() else {
            return Err(Rifiuto::NonMappato(format!(
                "il gesto cambia l'oggetto {} che non viene da Fub",
                a.id.0
            )));
        };
        let attrs = self.foglia(&e, b, a)?;
        if !attrs.is_empty() {
            let id = self.bersaglio(a.id)?;
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": attrs }));
        }
        Ok(())
    }

    /// Vero se `n` o un suo discendente non viene da un elemento di Fub.
    fn ha_estranei(&self, n: &Node) -> bool {
        self.copia.mappa.del_nodo(n.id).is_none()
            || n.children()
                .is_some_and(|c| c.iter().any(|c| self.ha_estranei(c)))
    }

    /// Gli attributi cambiati di un oggetto senza figli.
    fn foglia(&self, e: &Elemento, b: &Node, a: &Node) -> Result<Map<String, Value>, Rifiuto> {
        let mut attrs = Map::new();
        let g = e
            .ctm_genitore
            .ok_or_else(|| no("una transform di un antenato non si legge"))?;
        let t = e
            .propria
            .ok_or_else(|| no("la transform dell'elemento non si legge"))?;
        // Il riempimento di un testo cambiato nei pezzi del motore è il
        // `fill` del `<text>`: il confronto va avanti col testo di prima già
        // ricolorato.
        let ricolorato = riempimento_dei_pezzi(b, a)?;
        let b = match &ricolorato {
            Some((testo, colore)) => {
                attrs.insert("fill".into(), json!(scrivi_colore(Some(colore))?));
                testo
            }
            None => b,
        };
        let m = adatta(b, a).unwrap_or(Affine::IDENTITY);
        let con_tratti =
            mosso_da(b, m, true).ok_or_else(|| no("l'oggetto non si muove con una matrice"))?;
        let geometria_ok = geometrie_vicine(&con_tratti, a);
        let mut t_nuova = t;
        let candidato = if geometria_ok {
            if !vicina_all_identita(m) {
                t_nuova = nuova_trasformazione(e, m)?;
                attrs.insert("transform".into(), json!(scrivi_matrice(t_nuova)));
            }
            con_tratti
        } else if let (
            NodeKind::Path { live: None, .. },
            NodeKind::Path {
                path: pa,
                live: None,
                ..
            },
            "path",
        ) = (&b.kind, &a.kind, e.tag)
        {
            // Un tracciato cambiato punto per punto: il `d` nuovo, nello
            // spazio dell'elemento.
            let locale = (g * t).inverse();
            attrs.insert("d".into(), json!(scrivi_d(&trasformato(pa, locale))));
            let mut c = b.clone();
            c.kind = a.kind.clone();
            c.bbox_angle = a.bbox_angle;
            if !geometrie_vicine(&c, a) {
                return Err(no("il tracciato cambia anche in altro"));
            }
            c
        } else {
            return Err(no(format!(
                "<{}> cambia in un modo che i suoi attributi non dicono",
                e.tag
            )));
        };
        if aspetti_vicini(&candidato.appearance, &a.appearance) {
            return Ok(attrs);
        }
        // Lo spessore che non segue la scala, i colori pieni.
        let (prima, dopo) = senza_colori_nuovi(&candidato.appearance, &a.appearance);
        if !aspetti_vicini(&prima, &dopo) {
            return Err(no(
                "cambia l'aspetto in un modo che fill, stroke e stroke-width non dicono",
            ));
        }
        let (fb, fa) = (
            candidato.appearance.fill().map(|f| &f.paint),
            a.appearance.fill().map(|f| &f.paint),
        );
        if fb != fa {
            attrs.insert("fill".into(), json!(scrivi_colore(fa)?));
        }
        let (sb, sa) = (candidato.appearance.stroke(), a.appearance.stroke());
        if sb.map(|s| &s.paint) != sa.map(|s| &s.paint) {
            attrs.insert("stroke".into(), json!(scrivi_colore(sa.map(|s| &s.paint))?));
        }
        let (wb, wa) = (sb.map_or(0.0, |s| s.width), sa.map_or(0.0, |s| s.width));
        if !vicini(wb, wa) {
            let scala = (g * t_nuova).determinant().abs().sqrt();
            if scala <= 0.0 || !scala.is_finite() {
                return Err(no("lo spessore non si scrive in uno spazio schiacciato"));
            }
            attrs.insert(
                "stroke-width".into(),
                json!(numero(wa / scala, DECIMALI_GEOMETRIA)),
            );
        }
        Ok(attrs)
    }
}

/// `transform = G⁻¹·M·G·T`.
fn nuova_trasformazione(e: &Elemento, m: Affine) -> Result<Affine, Rifiuto> {
    let g = e
        .ctm_genitore
        .ok_or_else(|| no("una transform di un antenato non si legge"))?;
    let t = e
        .propria
        .ok_or_else(|| no("la transform dell'elemento non si legge"))?;
    let gi = g.inverse();
    let nuova = gi * m * g * t;
    if !nuova.is_finite() {
        return Err(no("la transform nuova non è finita"));
    }
    Ok(nuova)
}

/// Gli indici di una sottosequenza crescente più lunga fra le chiavi presenti.
fn sottosequenza_crescente(chiavi: &[Option<usize>]) -> HashSet<usize> {
    let presenti: Vec<(usize, usize)> = chiavi
        .iter()
        .enumerate()
        .filter_map(|(i, k)| k.map(|k| (i, k)))
        .collect();
    // Patience sorting con i predecessori.
    let mut code: Vec<usize> = Vec::new();
    let mut prec: Vec<Option<usize>> = vec![None; presenti.len()];
    for (j, &(_, k)) in presenti.iter().enumerate() {
        let at = code.partition_point(|&q| presenti[q].1 < k);
        if at > 0 {
            prec[j] = Some(code[at - 1]);
        }
        if at == code.len() {
            code.push(j);
        } else {
            code[at] = j;
        }
    }
    let mut fuori = HashSet::new();
    let mut cur = code.last().copied();
    while let Some(j) = cur {
        fuori.insert(presenti[j].0);
        cur = prec[j];
    }
    fuori
}

// ---------------------------------------------------------------------------
// La matrice di un cambio
// ---------------------------------------------------------------------------

/// I punti che dicono dove sta un oggetto, in ordine.
fn punti(n: &Node, out: &mut Vec<Point>) {
    let tre = |xf: &Affine, out: &mut Vec<Point>| {
        out.push(*xf * Point::new(0.0, 0.0));
        out.push(*xf * Point::new(1.0, 0.0));
        out.push(*xf * Point::new(0.0, 1.0));
    };
    match &n.kind {
        NodeKind::Path { path, live, .. } => {
            for s in &path.subpaths {
                for a in &s.anchors {
                    out.extend([a.p, a.h_in, a.h_out]);
                }
            }
            match live.as_deref() {
                Some(
                    LiveShape::Rectangle { xf, .. }
                    | LiveShape::Ellipse { xf, .. }
                    | LiveShape::Polygon { xf, .. },
                ) => tre(xf, out),
                Some(LiveShape::Line { a, b }) => out.extend([*a, *b]),
                _ => {}
            }
        }
        NodeKind::Text(t) => tre(&t.xf, out),
        NodeKind::Image(i) => tre(&i.xf, out),
        NodeKind::SymbolInstance { xf, .. } => tre(xf, out),
        _ => {}
    }
    if let Some(figli) = n.children() {
        for c in figli {
            punti(c, out);
        }
    }
}

/// La matrice che porta i punti di `b` su quelli di `a`, ai minimi quadrati;
/// `None` se i punti non sono gli stessi o non bastano a fissarla.
fn adatta(b: &Node, a: &Node) -> Option<Affine> {
    let (mut p, mut q) = (Vec::new(), Vec::new());
    punti(b, &mut p);
    punti(a, &mut q);
    if p.len() != q.len() || p.is_empty() {
        return None;
    }
    let d0 = q[0] - p[0];
    if p.iter()
        .zip(&q)
        .all(|(p, q)| vicini(q.x - p.x, d0.x) && vicini(q.y - p.y, d0.y))
    {
        return Some(Affine::translate(d0));
    }
    // Le equazioni normali, centrate per la stabilità.
    let n = p.len() as f64;
    let (cx, cy) = (
        p.iter().map(|p| p.x).sum::<f64>() / n,
        p.iter().map(|p| p.y).sum::<f64>() / n,
    );
    let (dx, dy) = (
        q.iter().map(|q| q.x).sum::<f64>() / n,
        q.iter().map(|q| q.y).sum::<f64>() / n,
    );
    let (mut sxx, mut sxy, mut syy) = (0.0, 0.0, 0.0);
    let (mut ux, mut uy, mut vx, mut vy) = (0.0, 0.0, 0.0, 0.0);
    for (p, q) in p.iter().zip(&q) {
        let (x, y) = (p.x - cx, p.y - cy);
        let (u, v) = (q.x - dx, q.y - dy);
        sxx += x * x;
        sxy += x * y;
        syy += y * y;
        ux += u * x;
        uy += u * y;
        vx += v * x;
        vy += v * y;
    }
    let det = sxx * syy - sxy * sxy;
    if det.abs() <= 1e-12 * (sxx * syy).max(1e-300) || !det.is_finite() {
        return None;
    }
    let a_ = (ux * syy - uy * sxy) / det;
    let c_ = (uy * sxx - ux * sxy) / det;
    let b_ = (vx * syy - vy * sxy) / det;
    let d_ = (vy * sxx - vx * sxy) / det;
    let e_ = dx - a_ * cx - c_ * cy;
    let f_ = dy - b_ * cx - d_ * cy;
    let m = Affine::new([a_, b_, c_, d_, e_, f_]);
    m.is_finite().then_some(m)
}

/// `n` mosso da `m` come lo muovono gli strumenti; `None` se il motore va in
/// panico.
fn mosso_da(n: &Node, m: Affine, tratti: bool) -> Option<Node> {
    vectorcraft_engine::guard::catch_panic(|| {
        let mut c = n.clone();
        if !vicina_all_identita(m) {
            c.transform(m, Scaling::from(tratti));
        }
        c
    })
    .ok()
}

fn vicina_all_identita(m: Affine) -> bool {
    matrici_vicine(m, Affine::IDENTITY)
}

fn matrici_vicine(a: Affine, b: Affine) -> bool {
    a.as_coeffs()
        .iter()
        .zip(b.as_coeffs())
        .all(|(x, y)| vicini(*x, y))
}

fn vicini(a: f64, b: f64) -> bool {
    (a - b).abs() <= TOLLERANZA * 1f64.max(a.abs()).max(b.abs())
}

fn json_vicini(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(x), Some(y)) => vicini(x, y),
            _ => x == y,
        },
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| json_vicini(x, y))
        }
        (Value::Object(x), Value::Object(y)) => {
            // Un campo che vale il suo predefinito non si scrive: uno zero
            // vicino a zero da una parte sola conta come assente.
            let chiavi: HashSet<&String> = x.keys().chain(y.keys()).collect();
            chiavi.into_iter().all(|k| match (x.get(k), y.get(k)) {
                (Some(x), Some(y)) => json_vicini(x, y),
                (Some(v), None) | (None, Some(v)) => v.as_f64().is_some_and(|v| vicini(v, 0.0)),
                (None, None) => true,
            })
        }
        _ => a == b,
    }
}

fn in_json(n: &Node) -> Value {
    serde_json::to_value(n).unwrap_or(Value::Null)
}

fn aspetto_in_json(a: &Appearance) -> Value {
    serde_json::to_value(a).unwrap_or(Value::Null)
}

/// Due oggetti uguali a meno dell'arrotondamento.
fn nodi_vicini(a: &Node, b: &Node) -> bool {
    json_vicini(&in_json(a), &in_json(b))
}

/// Due oggetti con la stessa geometria e le stesse proprietà, l'aspetto a
/// parte.
fn geometrie_vicine(a: &Node, b: &Node) -> bool {
    let senza = |n: &Node| {
        let mut v = in_json(n);
        if let Some(o) = v.as_object_mut() {
            o.remove("appearance");
        }
        v
    };
    json_vicini(&senza(a), &senza(b))
}

/// Le proprietà di un contenitore, i figli a parte.
fn proprieta_uguali(a: &Node, b: &Node) -> bool {
    let senza = |n: &Node| {
        let mut v = in_json(n);
        if let Some(o) = v.as_object_mut() {
            if let Some(k) = o.get_mut("kind").and_then(Value::as_object_mut) {
                k.remove("children");
                k.remove("content");
                k.remove("source");
            }
            o.remove("bbox_angle");
        }
        v
    };
    json_vicini(&senza(a), &senza(b))
}

fn aspetti_vicini(a: &Appearance, b: &Appearance) -> bool {
    json_vicini(&aspetto_in_json(a), &aspetto_in_json(b))
}

/// [`senza_colori`] di due aspetti, prima e dopo, senza il riempimento o il
/// tratto in cima che c'è da una parte sola: un riempimento o un tratto dato
/// a chi non l'aveva si scrive con `fill`, `stroke` e `stroke-width`, come lo
/// scrive il pannello del client (il resto del tratto nuovo, estremi e
/// angoli, il file lo prende da SVG).
fn senza_colori_nuovi(prima: &Appearance, dopo: &Appearance) -> (Appearance, Appearance) {
    let (mut p, mut d) = (senza_colori(prima), senza_colori(dopo));
    let in_cima = |a: &Appearance, riempimento: bool| {
        a.items.iter().rposition(|i| i.is_fill() == riempimento)
    };
    for riempimento in [true, false] {
        match (in_cima(&p, riempimento), in_cima(&d, riempimento)) {
            (Some(i), None) => {
                p.items.remove(i);
            }
            (None, Some(i)) => {
                d.items.remove(i);
            }
            _ => {}
        }
    }
    (p, d)
}

/// Il testo `b` ricolorato come `a` e il colore, se `a` è `b` coi pezzi
/// (`TextRun`) di un riempimento nuovo: il comando del riempimento del
/// motore colora i pezzi, il client scrive il `fill` del `<text>`. Si
/// scrive così solo se prima e dopo tutti i pezzi hanno lo stesso colore;
/// pezzi di colori diversi (un `tspan` col suo `fill`) non si dicono con un
/// attributo solo.
fn riempimento_dei_pezzi(b: &Node, a: &Node) -> Result<Option<(Node, Paint)>, Rifiuto> {
    let (NodeKind::Text(tb), NodeKind::Text(ta)) = (&b.kind, &a.kind) else {
        return Ok(None);
    };
    if tb.runs.len() != ta.runs.len()
        || tb
            .runs
            .iter()
            .zip(&ta.runs)
            .all(|(x, y)| x.style.fill == y.style.fill)
    {
        return Ok(None);
    }
    let unico = |pezzi: &[vectorcraft_doc::TextRun]| {
        let primo = &pezzi.first()?.style.fill;
        pezzi
            .iter()
            .all(|r| r.style.fill == *primo)
            .then(|| primo.clone())
    };
    let (Some(_), Some(colore)) = (unico(&tb.runs), unico(&ta.runs)) else {
        return Err(no("i pezzi del testo hanno colori diversi"));
    };
    let mut ricolorato = b.clone();
    if let NodeKind::Text(t) = &mut ricolorato.kind {
        for r in &mut t.runs {
            r.style.fill = colore.clone();
        }
    }
    Ok(Some((ricolorato, colore)))
}

/// L'aspetto senza il colore del riempimento, quello del tratto e lo
/// spessore: ciò che i tre attributi non dicono.
fn senza_colori(a: &Appearance) -> Appearance {
    let mut a = a.clone();
    if let Some(f) = a.fill_mut() {
        f.paint = Paint::None;
    }
    if let Some(s) = a.stroke_mut() {
        s.paint = Paint::None;
        s.width = 0.0;
    }
    a
}

// ---------------------------------------------------------------------------
// La scrittura
// ---------------------------------------------------------------------------

/// Un numero con al più `decimali` decimali, come `formatNumber` del client
/// (`apps/client/src/ink/number.ts`): `floor(v × 10ⁿ + 0,5)`, niente zeri in
/// fondo, niente esponente, mai `-0`.
pub fn numero(v: f64, decimali: usize) -> String {
    const POTENZE: [f64; 5] = [1.0, 10.0, 100.0, 1_000.0, 10_000.0];
    let fattore = POTENZE[decimali.min(4)];
    let unita = fub_scene::ink::round_half_up(v, fattore);
    if unita == 0.0 || !unita.is_finite() {
        return "0".into();
    }
    let negativo = unita < 0.0;
    let mut cifre = format!("{:.0}", unita.abs());
    if decimali > 0 {
        while cifre.len() < decimali + 1 {
            cifre.insert(0, '0');
        }
        let taglio = cifre.len() - decimali;
        let fine = cifre.trim_end_matches('0').len().max(taglio);
        cifre = if fine > taglio {
            format!("{}.{}", &cifre[..taglio], &cifre[taglio..fine])
        } else {
            cifre[..taglio].to_string()
        };
    }
    if negativo {
        format!("-{cifre}")
    } else {
        cifre
    }
}

/// `matrix(a b c d e f)` con quattro decimali, come `formatTransform`.
pub fn scrivi_matrice(m: Affine) -> String {
    let c: Vec<String> = m
        .as_coeffs()
        .iter()
        .map(|v| numero(*v, DECIMALI_MATRICE))
        .collect();
    format!("matrix({})", c.join(" "))
}

fn g2(v: f64) -> String {
    numero(v, DECIMALI_GEOMETRIA)
}

/// Il `d` di un tracciato del motore: `M`, `L`, `C`, `Z`, due decimali.
fn scrivi_d(p: &vectorcraft_geom::PathData) -> String {
    let mut parti: Vec<String> = Vec::new();
    for s in &p.subpaths {
        let Some(primo) = s.anchors.first() else {
            continue;
        };
        parti.push(format!("M{} {}", g2(primo.p.x), g2(primo.p.y)));
        let n = s.anchors.len();
        let segmenti = if s.closed { n } else { n.saturating_sub(1) };
        for i in 0..segmenti {
            let (a, b) = (&s.anchors[i], &s.anchors[(i + 1) % n]);
            let dritto = punti_uguali(a.h_out, a.p) && punti_uguali(b.h_in, b.p);
            if dritto {
                if s.closed && i + 1 == n {
                    break;
                }
                parti.push(format!("L{} {}", g2(b.p.x), g2(b.p.y)));
            } else {
                parti.push(format!(
                    "C{} {} {} {} {} {}",
                    g2(a.h_out.x),
                    g2(a.h_out.y),
                    g2(b.h_in.x),
                    g2(b.h_in.y),
                    g2(b.p.x),
                    g2(b.p.y)
                ));
            }
        }
        if s.closed {
            parti.push("Z".into());
        }
    }
    parti.join(" ")
}

/// `p` portato da `m`.
fn trasformato(p: &vectorcraft_geom::PathData, m: Affine) -> vectorcraft_geom::PathData {
    let mut c = p.clone();
    c.transform(m);
    c
}

fn punti_uguali(a: Point, b: Point) -> bool {
    (a.x - b.x).abs() <= 1e-9 && (a.y - b.y).abs() <= 1e-9
}

fn scrivi_colore(p: Option<&Paint>) -> Result<String, Rifiuto> {
    match p {
        None | Some(Paint::None) => Ok("none".into()),
        Some(Paint::Solid { color, .. }) => Ok(color.to_hex()),
        Some(_) => Err(no("un colore che non è pieno (sfumatura, motivo)")),
    }
}

/// L'`Elem` comune di un oggetto nuovo, nello spazio del genitore (`locale`
/// porta dal documento del motore lì): `rect`, `ellipse` e `line` quando la
/// forma lo è ancora dopo il passaggio, altrimenti `path`.
fn elem(n: &Node, locale: Affine) -> Result<(String, Map<String, Value>), Rifiuto> {
    let NodeKind::Path { path, live, .. } = &n.kind else {
        return Err(no("un oggetto nuovo che non è un tracciato"));
    };
    let p = trasformato(path, locale);
    let mut attrs = Map::new();
    let tag = match (live.as_deref(), &p.subpaths[..]) {
        (Some(LiveShape::Rectangle { radii, .. }), [s])
            if radii.iter().all(|r| *r == 0.0) && s.closed =>
        {
            match rettangolo(&p) {
                Some([x, y, w, h]) => {
                    attrs.insert("x".into(), json!(g2(x)));
                    attrs.insert("y".into(), json!(g2(y)));
                    attrs.insert("width".into(), json!(g2(w)));
                    attrs.insert("height".into(), json!(g2(h)));
                    "rect"
                }
                None => "path",
            }
        }
        (Some(LiveShape::Ellipse { pie, .. }), [s])
            if s.closed && (((pie.1 - pie.0).abs() - 360.0).abs() < 1e-9 || pie.0 == pie.1) =>
        {
            match ellisse(&p) {
                Some([cx, cy, rx, ry]) => {
                    attrs.insert("cx".into(), json!(g2(cx)));
                    attrs.insert("cy".into(), json!(g2(cy)));
                    attrs.insert("rx".into(), json!(g2(rx)));
                    attrs.insert("ry".into(), json!(g2(ry)));
                    "ellipse"
                }
                None => "path",
            }
        }
        (_, [s])
            if !s.closed
                && s.anchors.len() == 2
                && s.anchors
                    .iter()
                    .all(|a| punti_uguali(a.h_in, a.p) && punti_uguali(a.h_out, a.p)) =>
        {
            let (a, b) = (s.anchors[0].p, s.anchors[1].p);
            attrs.insert("x1".into(), json!(g2(a.x)));
            attrs.insert("y1".into(), json!(g2(a.y)));
            attrs.insert("x2".into(), json!(g2(b.x)));
            attrs.insert("y2".into(), json!(g2(b.y)));
            "line"
        }
        _ => "path",
    };
    if tag == "path" {
        attrs.insert("d".into(), json!(scrivi_d(&p)));
    }
    let fill = n.appearance.fill().map(|f| &f.paint);
    if tag != "line" || !matches!(fill, None | Some(Paint::None)) {
        attrs.insert("fill".into(), json!(scrivi_colore(fill)?));
    }
    if let Some(s) = n
        .appearance
        .stroke()
        .filter(|s| !matches!(s.paint, Paint::None))
    {
        attrs.insert("stroke".into(), json!(scrivi_colore(Some(&s.paint))?));
        let scala = locale.determinant().abs().sqrt();
        attrs.insert("stroke-width".into(), json!(g2(s.width * scala)));
        match s.cap {
            LineCap::Butt => {}
            LineCap::Round => {
                attrs.insert("stroke-linecap".into(), json!("round"));
            }
            LineCap::Square => {
                attrs.insert("stroke-linecap".into(), json!("square"));
            }
        }
        match s.join {
            LineJoin::Miter => {}
            LineJoin::Round => {
                attrs.insert("stroke-linejoin".into(), json!("round"));
            }
            LineJoin::Bevel => {
                attrs.insert("stroke-linejoin".into(), json!("bevel"));
            }
        }
    }
    Ok((tag.to_string(), attrs))
}

/// `[x, y, larghezza, altezza]` di un tracciato che è un rettangolo dritto.
fn rettangolo(p: &vectorcraft_geom::PathData) -> Option<[f64; 4]> {
    let s = p.subpaths.first()?;
    if s.anchors.len() != 4
        || s.anchors
            .iter()
            .any(|a| !punti_uguali(a.h_in, a.p) || !punti_uguali(a.h_out, a.p))
    {
        return None;
    }
    let xs: Vec<f64> = s.anchors.iter().map(|a| a.p.x).collect();
    let ys: Vec<f64> = s.anchors.iter().map(|a| a.p.y).collect();
    let (x0, x1) = (
        xs.iter().copied().fold(f64::INFINITY, f64::min),
        xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let (y0, y1) = (
        ys.iter().copied().fold(f64::INFINITY, f64::min),
        ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let agli_angoli = s.anchors.iter().all(|a| {
        (vicini(a.p.x, x0) || vicini(a.p.x, x1)) && (vicini(a.p.y, y0) || vicini(a.p.y, y1))
    });
    agli_angoli.then_some([x0, y0, x1 - x0, y1 - y0])
}

/// `[cx, cy, rx, ry]` di un tracciato che è un'ellisse dritta (quattro
/// ancore sui suoi estremi).
fn ellisse(p: &vectorcraft_geom::PathData) -> Option<[f64; 4]> {
    let s = p.subpaths.first()?;
    if s.anchors.len() != 4 {
        return None;
    }
    let xs: Vec<f64> = s.anchors.iter().map(|a| a.p.x).collect();
    let ys: Vec<f64> = s.anchors.iter().map(|a| a.p.y).collect();
    let (x0, x1) = (
        xs.iter().copied().fold(f64::INFINITY, f64::min),
        xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let (y0, y1) = (
        ys.iter().copied().fold(f64::INFINITY, f64::min),
        ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
    let sugli_estremi = s.anchors.iter().all(|a| {
        ((vicini(a.p.x, x0) || vicini(a.p.x, x1)) && vicini(a.p.y, cy))
            || ((vicini(a.p.y, y0) || vicini(a.p.y, y1)) && vicini(a.p.x, cx))
    });
    sugli_estremi.then_some([cx, cy, (x1 - x0) / 2.0, (y1 - y0) / 2.0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeri_come_il_client() {
        assert_eq!(numero(120.5, 2), "120.5");
        assert_eq!(numero(-0.03, 2), "-0.03");
        assert_eq!(numero(-0.001, 2), "0");
        // Come in JavaScript: 1,005 × 100 è 100,4999… in IEEE 754.
        assert_eq!(numero(1.005, 2), "1");
        assert_eq!(numero(0.125, 2), "0.13");
        assert_eq!(numero(272.09726, 4), "272.0973");
        assert_eq!(numero(-27.37204, 4), "-27.372");
        assert_eq!(numero(1e22, 0), "10000000000000000000000");
        assert_eq!(
            scrivi_matrice(Affine::translate((20.0, 5.0))),
            "matrix(1 0 0 1 20 5)"
        );
    }

    #[test]
    fn sottosequenza() {
        let k = [Some(0), Some(2), Some(1), None, Some(3)];
        let s = sottosequenza_crescente(&k);
        assert_eq!(s.len(), 3);
        assert!(s.contains(&0) && s.contains(&4));
        assert!(!s.contains(&3));
    }
}
