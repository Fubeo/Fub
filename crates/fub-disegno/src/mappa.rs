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

/// La lunghezza massima del nome di un livello di Fub, in caratteri
/// (`fub:layer`, `docs/reference/scene-format.md` §3).
pub const MAX_NOME_LIVELLO: usize = 80;

/// Il nome di serie di un livello nuovo, seguito dal suo numero: un documento
/// nuovo ha «Livello 1» (formato della scena, §3).
pub const NOME_DI_SERIE: &str = "Livello";

/// Perché `nome` non può essere il nome di un livello di Fub, o `None` se
/// può: vuoto (o di soli spazi), più lungo di [`MAX_NOME_LIVELLO`] caratteri,
/// o con un carattere che l'attributo non tiene com'è (un carattere di
/// controllo, che XML rifiuta o che la lettura di un attributo cambia in uno
/// spazio, e i non caratteri U+FFFE e U+FFFF).
pub fn nome_di_livello_sbagliato(nome: &str) -> Option<&'static str> {
    if nome.trim().is_empty() {
        return Some("Il nome del livello è vuoto: scrivi almeno un carattere.");
    }
    if nome.chars().count() > MAX_NOME_LIVELLO {
        return Some("Il nome del livello è troppo lungo: al massimo 80 caratteri.");
    }
    if nome
        .chars()
        .any(|c| c.is_control() || matches!(c, '\u{FFFE}' | '\u{FFFF}'))
    {
        return Some(
            "Il nome del livello ha un carattere che il file non tiene: togli a capo, tabulazioni e caratteri di controllo.",
        );
    }
    None
}

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
    /// Il nome di un livello di Fub (`fub:layer`, formato della scena §3);
    /// `None` per ogni altro elemento.
    pub livello: Option<String>,
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
    /// Le righe di un `<text>` e come sono scritte; `None` per gli altri.
    pub testo: Option<InfoTesto>,
    /// L'elemento ha l'attributo `clip-path`: Rilascia lo toglie con un
    /// `set`. Un ritaglio scritto in `style` o dato da un foglio di stile
    /// non si toglie così.
    pub clip_path: bool,
    /// L'id del `clipPath` che l'attributo `clip-path` nomina
    /// (`url(#id)`), se lo nomina così.
    pub ritaglio: Option<String>,
    /// `fub:role="private"`: una risorsa di FubDraw, che se ne va con
    /// l'ultimo riferimento.
    pub privato: bool,
    /// La forma del `clipPath` privato di un gruppo di ritaglio, legata al
    /// tracciato che ritaglia del motore ([`Mappa::lega_i_ritagli`]).
    pub ritaglia: bool,
}

/// Ciò che la differenza sa di un `<text>` del file per scriverne le parole
/// e il carattere (K6 T16): le righe come sono scritte e che cosa dicono i
/// `<tspan>` dentro.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct InfoTesto {
    /// Una riga per `<tspan>`, come l'operazione `text` le sostituisce.
    pub righe: Vec<String>,
    /// Un testo di punto: niente `fub:wrap`, niente tracciato, niente
    /// etichetta di un connettore.
    pub di_punto: bool,
    /// Più `<tspan>` che righe: una riga ha pezzi con un aspetto loro.
    pub pezzi: bool,
    /// I nomi degli attributi dei `<tspan>` oltre a `x`, `dy` e `fub:join`:
    /// un attributo del `<text>` non arriva dove una riga ne scrive uno suo.
    pub attributi_delle_righe: std::collections::BTreeSet<String>,
    /// Gli attributi del `<text>`, nell'ordine del file e con le entità
    /// sciolte: un testo che si riscrive intero (in area, con un'altra
    /// interlinea) li tiene.
    pub attributi: Vec<(String, String)>,
    /// `fub:wrap` letto: la larghezza di un testo in area.
    pub wrap: Option<f64>,
    /// L'id del tracciato privato che il `textPath` di un testo su tracciato segue (formato del
    /// testo, §5); `None` per gli altri testi e per l'etichetta di un connettore.
    pub tracciato: Option<String>,
    /// Il `fub:join` di ogni `<tspan>`, come è scritto.
    pub unioni: Vec<Option<String>>,
    /// Il `dx` di ogni `<tspan>`: in un testo verticale, quanto la colonna
    /// si sposta da quella prima (formato del testo, §10).
    pub scarti: Vec<Option<f64>>,
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

/// Il motivo del `clipPath` privato di una maschera la cui forma è legata
/// ([`Mappa::lega_i_ritagli`]): non è un oggetto del motore, ma non è una
/// perdita, perché un cambio della forma lo riscrive.
pub(crate) const RITAGLIO_LEGATO: &str = "il ritaglio di una maschera, che la maschera riscrive";

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
    /// Le ricette del file ([`crate::ricetta`]).
    pub(crate) ricette: crate::ricetta::Ricette,
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
                    // La carta non si sceglie né si sposta: per gli
                    // strumenti del motore è bloccata come un `fub:locked`.
                    if e.bloccato || e.ruolo == Role::Paper {
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
            ricette: Default::default(),
        }
    }

    /// Lega le facce e i bordi di ogni gruppo della Pittura dinamica agli
    /// elementi figli del suo elemento, per posizione: il file li scrive come
    /// il motore li tiene, senza il gruppo nascosto delle sorgenti, e il
    /// figlio `k` del file (contando anche gli estranei) è il pezzo `k`. Così
    /// la Selezione pittura li sceglie con l'id del file, e i comandi (il
    /// colore, Elimina) li trovano come ogni altro oggetto. Gli elementi
    /// restano [`crate::ricetta::COPERTO`]: la ricetta del gruppo li riscrive,
    /// e non sono perdite. Un bordo che la scena tiene estraneo non è un
    /// elemento e resta senza legame.
    /// Se un figlio sta oltre i pezzi del motore (un file cambiato a mano)
    /// non se ne lega nessuno, e il gruppo si sceglie intero.
    pub(crate) fn lega_le_facce(&mut self, doc: &Document) {
        use vectorcraft_tools::builder::{is_live_paint, SOURCES_NAME};
        let gruppi: Vec<(usize, NodeId)> = self.per_nodo.iter().map(|(n, i)| (*i, *n)).collect();
        for (i, nodo) in gruppi {
            let Some(n) = doc.node(nodo).filter(|n| is_live_paint(n)) else {
                continue;
            };
            let pezzi: Vec<NodeId> = n
                .children()
                .into_iter()
                .flatten()
                .filter(|c| c.name.as_deref() != Some(SOURCES_NAME))
                .map(|c| c.id)
                .collect();
            let figli: Vec<(usize, usize)> = (0..self.elementi.len())
                .filter(|j| self.elementi[*j].genitore == Some(i))
                .filter_map(|j| Some((j, *self.elementi[j].percorso.last()?)))
                .collect();
            if figli.iter().any(|(_, k)| *k >= pezzi.len()) {
                continue;
            }
            for (j, k) in figli {
                self.elementi[j].nodo = Some(pezzi[k]);
                self.per_nodo.insert(pezzi[k], j);
            }
        }
    }

    /// Lega la forma del `clipPath` privato di ogni gruppo di ritaglio al
    /// tracciato che ritaglia del motore (il primo figlio del gruppo), come
    /// [`Mappa::lega_le_facce`]: così «Modifica maschera» la sceglie con
    /// l'id del file, e un cambio della forma si scrive sul posto. Vale
    /// solo per un `clipPath` privato, nominato da un gruppo solo, con una
    /// forma sola che ha un id (formato della scena, risorse). La forma
    /// sta nello spazio del gruppo (`userSpaceOnUse`): il suo genitore,
    /// per le matrici, è il gruppo.
    pub(crate) fn lega_i_ritagli(&mut self, doc: &Document) {
        use vectorcraft_doc::NodeKind;
        let mut usi: HashMap<&str, usize> = HashMap::new();
        for e in &self.elementi {
            if let Some(r) = e.ritaglio.as_deref() {
                *usi.entry(r).or_default() += 1;
            }
        }
        let mut legami = Vec::new();
        for (i, e) in self.elementi.iter().enumerate() {
            let (Some(r), Some(nodo)) = (e.ritaglio.as_deref(), e.nodo) else {
                continue;
            };
            if usi.get(r) != Some(&1) {
                continue;
            }
            let Some(c) = doc.node(nodo).and_then(|n| match &n.kind {
                NodeKind::Group {
                    children,
                    clip: true,
                } => children.first(),
                _ => None,
            }) else {
                continue;
            };
            if self.per_nodo.contains_key(&c.id) {
                continue;
            }
            let Some(&k) = self.per_id.get(r) else {
                continue;
            };
            let risorsa = &self.elementi[k];
            if risorsa.tag != "clipPath" || !risorsa.privato {
                continue;
            }
            let figli: Vec<usize> = (0..self.elementi.len())
                .filter(|j| self.elementi[*j].genitore == Some(k))
                .collect();
            let [j] = figli[..] else { continue };
            if self.elementi[j].id.is_none() || self.elementi[j].nodo.is_some() {
                continue;
            }
            legami.push((i, j, k, c.id, e.ctm()));
        }
        for (i, j, k, nodo, ctm) in legami {
            // Il `clipPath` non è una perdita: la maschera lo riscrive.
            self.elementi[k].motivo = Some(RITAGLIO_LEGATO);
            let f = &mut self.elementi[j];
            f.nodo = Some(nodo);
            f.motivo = None;
            f.genitore = Some(i);
            f.ctm_genitore = ctm;
            f.ritaglia = true;
            self.per_nodo.insert(nodo, j);
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

    /// Quanti elementi sono mappati: quelli che il motore ha, più la carta che Fub tiene fuori dal
    /// motore apposta ([`crate::apertura::CARTA_FUORI`]), che non è una perdita.
    pub fn mappati(&self) -> usize {
        self.per_nodo.len() + self.carte_fuori()
    }

    /// Quanti elementi non lo sono.
    pub fn non_mappati(&self) -> usize {
        self.elementi.len() - self.mappati()
    }

    fn carte_fuori(&self) -> usize {
        self.elementi
            .iter()
            .filter(|e| e.motivo == Some(crate::apertura::CARTA_FUORI))
            .count()
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

    /// L'id della carta del file (il `rect` della radice con
    /// `fub:role="paper"`), se c'è: dentro il motore o fuori.
    pub fn carta(&self) -> Option<&str> {
        self.elementi
            .iter()
            .find(|e| e.ruolo == Role::Paper && e.genitore.is_none())
            .and_then(Elemento::id_del_file)
    }

    /// Le ricette del file.
    pub fn ricette(&self) -> &crate::ricetta::Ricette {
        &self.ricette
    }

    /// Il nome di un livello nuovo: «Livello N» col primo N, dal numero dei
    /// livelli di Fub più uno, che nessun livello porta già (come
    /// `freshLayerName` del client).
    pub fn nome_libero(&self) -> String {
        let livelli: Vec<&str> = self
            .elementi
            .iter()
            .filter_map(|e| e.livello.as_deref())
            .collect();
        let mut n = livelli.len() + 1;
        let presi: HashSet<&str> = livelli.into_iter().collect();
        loop {
            let nome = format!("{NOME_DI_SERIE} {n}");
            if !presi.contains(nome.as_str()) {
                return nome;
            }
            n += 1;
        }
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
