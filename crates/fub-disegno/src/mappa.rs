//! La mappa fra gli elementi della scena di Fub e gli oggetti del motore.
//!
//! L'import dà a ogni oggetto il nome dell'elemento da cui viene, il suo id:
//! quello del file o quello sintetico della copia (`fubtmp-<n>`). Un elemento
//! è mappato quando nel documento del motore c'è esattamente un oggetto con
//! il suo nome; nessuno (il motore non ne fa un oggetto) o più d'uno (un
//! `<use>` che lo ripete) lo lasciano fuori. Gli elementi senza id del file
//! restano indicati dal loro percorso e dal tag: la differenza dà loro un id
//! con `ident` quando un gesto li tocca.
//!
//! I livelli del motore che non vengono da un elemento (quello che l'import
//! crea quando la radice non ha solo livelli) stanno per la radice, `#root`.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use fub_scene::Role;
use vectorcraft_doc::{Document, Node, NodeId};
use vectorcraft_geom::Affine;

/// Un elemento di Fub che il motore potrebbe modificare.
#[derive(Clone, Debug)]
pub struct Elemento {
    /// Il percorso nella scena (indici dei figli elemento dalla radice).
    pub percorso: Vec<usize>,
    pub tag: &'static str,
    pub ruolo: Role,
    /// L'id nel file, se c'è.
    pub id: Option<String>,
    /// Il nome nel motore: l'id del file o quello sintetico.
    pub nome: String,
    /// L'elemento che lo contiene, fra quelli della mappa; `None` sotto la
    /// radice.
    pub genitore: Option<usize>,
    /// La sua `transform`; `None` se non si legge (anche se viene da `style`).
    pub propria: Option<Affine>,
    /// Dallo spazio del genitore al documento del motore; `None` se una
    /// `transform` di un antenato non si legge.
    pub ctm_genitore: Option<Affine>,
    /// `fub:locked`.
    pub bloccato: bool,
    /// `display="none"`.
    pub nascosto: bool,
    /// L'oggetto del motore, se l'elemento è mappato.
    pub nodo: Option<NodeId>,
    /// Perché non è mappato, quando si sa prima dell'import.
    pub motivo: Option<&'static str>,
}

impl Elemento {
    /// Dal suo spazio al documento del motore.
    pub fn ctm(&self) -> Option<Affine> {
        Some(self.ctm_genitore? * self.propria?)
    }

    /// Il bersaglio di un'operazione: l'id del file.
    pub fn id_del_file(&self) -> Option<&str> {
        self.id.as_deref()
    }
}

/// Oggetti del motore ↔ elementi di Fub.
#[derive(Clone, Debug, Default)]
pub struct Mappa {
    elementi: Vec<Elemento>,
    per_nodo: HashMap<NodeId, usize>,
    per_id: HashMap<String, usize>,
    radici: HashSet<NodeId>,
    /// Ogni id del file, anche di elementi fuori dalla mappa: gli id nuovi
    /// non devono esserne uguali.
    ids: HashSet<String>,
}

impl Mappa {
    /// Lega gli elementi agli oggetti di `doc` e segna bloccati, nel motore,
    /// gli oggetti degli elementi bloccati.
    pub(crate) fn nuova(mut elementi: Vec<Elemento>, doc: &mut Document) -> Mappa {
        let mut per_nome: HashMap<&str, Vec<NodeId>> = HashMap::new();
        doc.walk(|n| {
            if let Some(nome) = n.name.as_deref() {
                if !nome.is_empty() {
                    per_nome.entry(nome).or_default().push(n.id);
                }
            }
        });
        let mut per_nodo = HashMap::new();
        let mut per_id = HashMap::new();
        let mut ids = HashSet::new();
        let mut bloccati = Vec::new();
        for (i, e) in elementi.iter_mut().enumerate() {
            if let Some(id) = &e.id {
                per_id.insert(id.clone(), i);
                ids.insert(id.clone());
            }
            if e.motivo.is_some() {
                continue;
            }
            match per_nome.get(e.nome.as_str()).map(Vec::as_slice) {
                Some([nodo]) => {
                    e.nodo = Some(*nodo);
                    per_nodo.insert(*nodo, i);
                    if e.bloccato {
                        bloccati.push(*nodo);
                    }
                }
                Some([_, _, ..]) => {
                    e.motivo =
                        Some("più oggetti del motore con lo stesso nome (un <use> lo ripete)")
                }
                _ => e.motivo = Some("il motore non ne fa un oggetto suo"),
            }
        }
        for nodo in bloccati {
            if let Some(n) = doc.node_mut(nodo) {
                n.locked = true;
            }
        }
        let radici = doc
            .layers
            .iter()
            .map(|l| l.id)
            .filter(|id| !per_nodo.contains_key(id))
            .collect();
        Mappa {
            elementi,
            per_nodo,
            per_id,
            radici,
            ids,
        }
    }

    /// Ogni elemento candidato, mappato o no.
    pub fn elementi(&self) -> &[Elemento] {
        &self.elementi
    }

    /// L'elemento `i`.
    pub fn elemento(&self, i: usize) -> Option<&Elemento> {
        self.elementi.get(i)
    }

    /// Quanti elementi sono mappati.
    pub fn mappati(&self) -> usize {
        self.per_nodo.len()
    }

    /// Quanti elementi non lo sono.
    pub fn non_mappati(&self) -> usize {
        self.elementi.len() - self.per_nodo.len()
    }

    /// L'indice dell'elemento da cui viene l'oggetto `nodo`.
    pub fn del_nodo(&self, nodo: NodeId) -> Option<usize> {
        self.per_nodo.get(&nodo).copied()
    }

    /// L'indice dell'elemento con l'id del file `id`.
    pub fn dell_id(&self, id: &str) -> Option<usize> {
        self.per_id.get(id).copied()
    }

    /// Vero se `nodo` è un livello del motore che sta per la radice.
    pub fn e_radice(&self, nodo: NodeId) -> bool {
        self.radici.contains(&nodo)
    }

    /// Vero se `id` è già un id del file.
    pub fn id_preso(&self, id: &str) -> bool {
        self.ids.contains(id)
    }
}

/// Dove sta ogni oggetto di un documento del motore: il genitore (`None` per
/// un livello in cima) e la posizione fra i fratelli.
pub(crate) struct Posti<'a> {
    pub nodi: HashMap<NodeId, Posto<'a>>,
}

/// Il posto di un oggetto.
pub(crate) struct Posto<'a> {
    pub nodo: &'a Arc<Node>,
    pub genitore: Option<NodeId>,
    pub indice: usize,
}

impl<'a> Posti<'a> {
    /// I posti di ogni oggetto di `doc`.
    pub fn di(doc: &'a Document) -> Posti<'a> {
        fn giu<'a>(
            n: &'a Arc<Node>,
            genitore: Option<NodeId>,
            indice: usize,
            nodi: &mut HashMap<NodeId, Posto<'a>>,
        ) {
            nodi.insert(
                n.id,
                Posto {
                    nodo: n,
                    genitore,
                    indice,
                },
            );
            if let Some(figli) = n.children() {
                for (i, c) in figli.iter().enumerate() {
                    giu(c, Some(n.id), i, nodi);
                }
            }
        }
        let mut nodi = HashMap::new();
        for (i, l) in doc.layers.iter().enumerate() {
            giu(l, None, i, &mut nodi);
        }
        Posti { nodi }
    }
}
