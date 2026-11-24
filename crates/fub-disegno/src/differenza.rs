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
//!   `transform` lui, non i figli; un livello mai. Quando il gesto dice
//!   quali oggetti ha scelto (le unità della Selezione), la `transform` va a
//!   quelli, come la scrive il client. I colori pieni e lo
//!   spessore diventano `fill`, `stroke`, `stroke-width`; un tracciato
//!   cambiato in un modo che nessuna matrice spiega diventa `d`. Quando il
//!   cambio sposta i punti (uno strumento o un comando dei tracciati, la
//!   Selezione diretta), solo uno spostamento puro diventa `transform`: un
//!   punto spostato diventa sempre `d`, anche se per caso una matrice
//!   inclinata lo spiegherebbe.
//! - **`add`** per gli oggetti nuovi, con l'`Elem` come lo scrive il client
//!   (`rect`, `ellipse`, `line` o `path`, geometria con due decimali); uno
//!   strumento può scriverlo lui ([`Scrittore`]). Un gruppo nuovo fatto di
//!   oggetti che c'erano già (Raggruppa) è un `<g>` vuoto con un id nuovo,
//!   dove il motore lo mette, e un `move` per ognuno dei suoi figli, dopo
//!   l'`add`: gli elementi restano quelli, con i loro byte.
//! - **Bloccato e nascosto** sono gli attributi di Fub (`fub:locked="true"`,
//!   `display="none"`, `docs/reference/scene-format.md` §3), come li scrivono
//!   «Blocca» e «Nascondi» del client: un `set` che li mette o li toglie.
//!   Il foglio di Fub resta bloccato com'è.
//! - **Livelli**: un livello di Fub è un livello del motore che si chiama
//!   col suo id; un nome diverso è un livello rinominato, e diventa il `set`
//!   di `fub:layer`. Un livello nuovo in cima al documento del motore è un
//!   `add` di `<g id="l…" fub:layer="Nome">` vuoto nella radice, al suo posto
//!   fra i livelli, con `fub:locked` e `display` se nasce bloccato o
//!   nascosto. Un nome vuoto o oltre 80 caratteri, e le opzioni che il
//!   formato non ha (colore a parte, che non si scrive), si rifiutano.
//! - **Tracciati composti**: un composto del motore si scrive come un solo
//!   `<path>` col `d` unito dei suoi sottotracciati (il buco viene dal verso,
//!   regola `nonzero`). Crea composto toglie i tracciati assorbiti e
//!   aggiunge il composto come un `<path>` nuovo; Rilascia toglie il
//!   composto e aggiunge i suoi tracciati liberati; Inverti o punti aggiunti
//!   su un composto sono un `set` del `d`. Cambiare la regola di riempimento
//!   è `unsupported`: `fill-rule` non è un attributo della scena.
//! - **Forme composte**: una forma composta del motore (un gruppo segnato)
//!   assorbe e libera i suoi membri come un composto, ma si scrive come un
//!   oggetto ricco: il `g` col disegno espanso e la ricetta. Un oggetto ricco
//!   nuovo che non disegna niente (una composta in Intersezione di forme che
//!   non si toccano) è `empty`: un `g` vuoto, riaperto, perderebbe la ricetta.
//! - **Ritagli** (`differenza_ritagli.rs`): un gruppo di ritaglio nuovo del
//!   motore si scrive come SVG semplice, un `<g clip-path="url(#…)">` coi suoi
//!   contenuti e un `<clipPath>` privato in `fub-defs` col tracciato che
//!   ritaglia; rilasciato, il tracciato torna primo figlio del gruppo, senza
//!   colore, e il `clip-path` si toglie con un `set`.
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
use vectorcraft_geom::{Affine, FillRule, PathData, Point};

use crate::apertura::Copia;
use crate::campioni::{self, NonSiScrive, Riferimenti};
use crate::id::{self, Specie};
use crate::mappa::{Elemento, Mappa, Posti};
use crate::ricetta::{self, Esito};
use crate::sfumature;

/// Gli attributi di una foglia da scrivere, e le sfumature nuove che le servono, ognuna col canale
/// (`fill` o `stroke`) che la usa.
type AttributiDellaFoglia = (Map<String, Value>, Vec<(&'static str, sfumature::Scritta)>);

#[path = "differenza_righe.rs"]
mod righe;
#[path = "differenza_ritagli.rs"]
mod ritagli;
#[path = "differenza_testo.rs"]
mod testo;
pub(crate) use righe::righe_scritte;
pub(crate) use testo::peso_e_corsivo;
use testo::{da_riscrivere, riscrittura, testo_cambiato, TestoRiscritto};

/// `fill-rule` non è un attributo della scena (`docs/reference/scene-format.md`
/// §4): un elemento che lo scrive diventerebbe estraneo, e i buchi si fanno
/// col verso dei sottotracciati, con la regola `nonzero` di SVG.
const REGOLA_FUORI: &str =
    "la regola di riempimento evenodd non è un attributo della scena: i buchi vanno col verso";

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
    /// Un oggetto ricco nuovo o riscritto non disegna niente: il suo corpo
    /// sarebbe un `g` vuoto, che riaperto perderebbe la ricetta.
    Vuoto,
}

impl Rifiuto {
    /// Il rifiuto del contratto.
    pub fn rifiuto(&self) -> DrawingRefusal {
        match self {
            Rifiuto::NonSupportato(_) => DrawingRefusal::Unsupported,
            Rifiuto::NonMappato(_) => DrawingRefusal::Unmapped,
            Rifiuto::TroppoGrande => DrawingRefusal::TooLarge,
            Rifiuto::Vuoto => DrawingRefusal::Empty,
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
///
/// `unita` sono gli oggetti che il gesto ha scelto e trasformato (le unità
/// della Selezione, `unitsOf` nel client): un gruppo fra loro mosso tutto da
/// una matrice riceve la `transform` lui, anche con un figlio solo, e un
/// gruppo fuori da loro non la riceve mai, la ricevono i suoi figli. `None`
/// (un comando, una prova a mano) lascia la regola senza scelta: la
/// `transform` va al gruppo se ha più figli o figli che non vengono da Fub,
/// se no al figlio.
///
/// `punti` dice che il cambio sposta i punti dei tracciati (la Selezione
/// diretta, la penna, un comando sui punti): allora una matrice spiega un
/// oggetto solo se è uno spostamento. Una polilinea con un punto spostato può
/// coincidere per caso con la stessa polilinea inclinata o stirata, e la
/// `transform` (con lo spessore corretto) non sarebbe ciò che si è fatto.
pub(crate) fn differenza(
    copia: &Copia,
    dopo: &Document,
    scrittore: Option<Scrittore<'_>>,
    unita: Option<&HashSet<NodeId>>,
    punti: bool,
) -> Result<Differenza, Rifiuto> {
    let prima = Posti::di(&copia.documento);
    let poi = Posti::di(dopo);
    let mut lavoro = Lavoro {
        copia,
        scrittore,
        unita,
        punti,
        ident: Vec::new(),
        remove: Vec::new(),
        moves: Vec::new(),
        add: Vec::new(),
        dentro: Vec::new(),
        set: Vec::new(),
        ids: HashMap::new(),
        gruppi_nuovi: HashMap::new(),
        dati: HashSet::new(),
        riscritti: HashSet::new(),
        testi_riscritti: HashMap::new(),
        ricette: ricetta::Scritte::default(),
        liberati: HashSet::new(),
        assorbiti: HashSet::new(),
        riferimenti: Riferimenti::default(),
        sfumature: Vec::new(),
    };
    // I campioni per primi: gli id dei campioni nuovi servono a chi li usa.
    let dei_campioni = {
        let mappa = &copia.mappa;
        let dati = &mut lavoro.dati;
        campioni::operazioni(&copia.campioni, dopo, &mut || {
            let id = id::nuovo(Specie::Risorsa, &|id| {
                mappa.id_preso(id) || dati.contains(id)
            })?;
            dati.insert(id.clone());
            Some(id)
        })
        .map_err(|e| match e {
            NonSiScrive::Forma(m) => no(m),
            NonSiScrive::NomeDiUnMotivo(nome) => {
                no(format!("«{nome}» è già il nome di un motivo del documento"))
            }
        })?
    };
    lavoro.riferimenti = dei_campioni.riferimenti;
    lavoro.composti(&prima, &poi);
    lavoro.ritagli(&prima, &poi);
    // Il confronto per primo: dice quali oggetti si riscrivono interi
    // (tolti e rimessi con la loro ricetta), che le altre fasi saltano.
    for l in &dopo.layers {
        let Some(p) = prima.nodi.get(&l.id) else {
            continue;
        };
        lavoro.confronta(p.nodo, l, &prima)?;
    }
    let ident_del_confronto = std::mem::take(&mut lavoro.ident);
    lavoro.tolti(&prima, &poi)?;
    // I nuovi prima dell'ordine: un gruppo nuovo dev'essere noto quando i
    // suoi figli ci si spostano dentro.
    lavoro.nuovi(&prima, dopo)?;
    lavoro.ordine(&prima, dopo)?;
    lavoro.ident.extend(ident_del_confronto);
    // Le tavole: le operazioni sui `view` e sulle loro carte, che il motore
    // non ha come oggetti (`crate::tavole`).
    let delle_tavole = {
        let mappa = &copia.mappa;
        let dati = &mut lavoro.dati;
        crate::tavole::operazioni(
            &copia.tavole,
            &copia.documento.artboards,
            &dopo.artboards,
            copia.radice,
            &mut |specie| {
                let id = id::nuovo(specie, &|id| mappa.id_preso(id) || dati.contains(id))?;
                dati.insert(id.clone());
                Some(id)
            },
        )
        .map_err(|e| match e {
            crate::tavole::NonSiScrive::FuoriRegola => {
                no("le carte del file non vanno con le loro tavole: le tavole non cambiano")
            }
            crate::tavole::NonSiScrive::Id => no("nessun id nuovo libero"),
            crate::tavole::NonSiScrive::Matrice => no("la radice del file non si inverte"),
        })?
    };
    let Lavoro {
        ident,
        mut remove,
        moves,
        mut add,
        dentro,
        set,
        ids,
        ricette: scritte,
        sfumature,
        ..
    } = lavoro;
    // Il blocco delle ricette cambia solo con un gesto che scrive.
    if !(ident.is_empty()
        && remove.is_empty()
        && moves.is_empty()
        && add.is_empty()
        && dentro.is_empty()
        && set.is_empty())
    {
        let (via, nuovo) = scritte.operazioni(copia.mappa.ricette());
        remove.extend(via);
        add.extend(nuovo);
    }
    // I `remove` per percorso: dall'ultimo al primo, così ogni percorso vale
    // ancora quando tocca a lui.
    remove.sort_by(|a, b| b.0.cmp(&a.0));
    // Un oggetto che esce da un elemento tolto (separare un gruppo) si sposta
    // prima che il suo genitore se ne vada: dopo, la scena non lo troverebbe.
    let (salvati, moves) = salvati_prima(copia, &remove, moves)?;
    let mut ops = ident;
    ops.extend(salvati);
    ops.extend(remove.into_iter().map(|(_, op)| op));
    ops.extend(moves);
    ops.extend(add);
    ops.extend(dentro);
    ops.extend(set);
    if ops.len() > MAX_DRAWING_OPS {
        return Err(Rifiuto::TroppoGrande);
    }
    crate::perdite::controlla(&copia.perdite, &ops).map_err(Rifiuto::NonMappato)?;
    // Le tavole non sono oggetti del motore: il controllo delle parti non
    // mappate non le guarda.
    ops.extend(delle_tavole);
    // I campioni nuovi o cambiati prima di chi li usa, quelli tolti per
    // ultimi, quando nessuno li usa più. Sono risorse, non oggetti del
    // disegno: il controllo delle parti non mappate non li guarda.
    // Le sfumature private nuove, dopo i campioni (che possono aver fatto la
    // `fub-defs`) e prima di chi le usa; le vecchie le toglie la scena con
    // il loro ultimo riferimento.
    let sfumature = ops_delle_sfumature(copia, &dei_campioni.davanti, sfumature);
    let mut ops = if dei_campioni.davanti.is_empty() && sfumature.is_empty() {
        ops
    } else {
        let mut tutte = dei_campioni.davanti;
        tutte.extend(sfumature);
        tutte.extend(ops);
        tutte
    };
    ops.extend(dei_campioni.in_fondo);
    if ops.len() > MAX_DRAWING_OPS {
        return Err(Rifiuto::TroppoGrande);
    }
    Ok(Differenza { ops, ids })
}

/// Divide i `move` in quelli che portano fuori un oggetto da un elemento tolto,
/// che vanno prima dei `remove`, e gli altri. Un `remove` per percorso (un
/// elemento senza id) con un oggetto da portare fuori si rifiuta: lo
/// spostamento di prima cambierebbe il percorso.
fn salvati_prima(
    copia: &Copia,
    remove: &[(Vec<usize>, Value)],
    moves: Vec<Value>,
) -> Result<(Vec<Value>, Vec<Value>), Rifiuto> {
    if remove.is_empty() || moves.is_empty() {
        return Ok((Vec::new(), moves));
    }
    let percorso_di = |id: &str| {
        copia
            .mappa
            .elementi()
            .iter()
            .find(|e| e.id.as_deref() == Some(id))
            .map(|e| e.percorso.clone())
    };
    let (mut salvati, mut altri) = (Vec::new(), Vec::new());
    for m in moves {
        let dentro = m["target"].as_str().and_then(percorso_di).is_some_and(|p| {
            remove
                .iter()
                .any(|(r, _)| p.len() > r.len() && p.starts_with(r))
        });
        if dentro {
            salvati.push(m);
        } else {
            altri.push(m);
        }
    }
    if !salvati.is_empty() && remove.iter().any(|(_, op)| !op["target"].is_string()) {
        return Err(no(
            "un oggetto esce da un elemento tolto che non ha id: non si fa in un passo",
        ));
    }
    Ok((salvati, altri))
}

/// Gli `add` delle sfumature private nuove `elems`: nella `fub-defs` del
/// file o in quella che i campioni del gesto fanno (`campioni`), se no in
/// una nuova in testa alla radice, come la fanno i campioni.
fn ops_delle_sfumature(copia: &Copia, campioni: &[Value], elems: Vec<Value>) -> Vec<Value> {
    if elems.is_empty() {
        return Vec::new();
    }
    let fatta_dai_campioni = campioni.iter().any(|op| {
        op["elem"]["tag"] == "defs" && op["elem"]["attrs"]["id"] == campioni::DEFS_DI_FUB
    });
    let defs = copia
        .campioni
        .defs
        .clone()
        .or_else(|| fatta_dai_campioni.then(|| campioni::DEFS_DI_FUB.to_string()));
    match defs {
        Some(defs) => elems
            .into_iter()
            .map(|elem| json!({ "op": "add", "parent": defs, "pos": { "last": true }, "elem": elem }))
            .collect(),
        None => vec![json!({
            "op": "add", "parent": "#root", "pos": { "first": true },
            "elem": { "tag": "defs", "attrs": { "id": campioni::DEFS_DI_FUB }, "children": elems },
        })],
    }
}

/// Gli `add` delle risorse nuove `elems` di un gesto, come quelle delle
/// sfumature: nella `fub-defs` del file, o in quella che le `ops` del gesto
/// fanno, se no in una nuova.
pub(crate) fn ops_delle_risorse(copia: &Copia, ops: &Value, elems: Vec<Value>) -> Vec<Value> {
    let mut piatte = Vec::new();
    for op in ops.as_array().into_iter().flatten() {
        match op["ops"].as_array() {
            Some(dentro) => piatte.extend(dentro.iter().cloned()),
            None => piatte.push(op.clone()),
        }
    }
    ops_delle_sfumature(copia, &piatte, elems)
}

struct Lavoro<'a> {
    copia: &'a Copia,
    scrittore: Option<Scrittore<'a>>,
    /// Gli oggetti scelti dal gesto, se il gesto li dice.
    unita: Option<&'a HashSet<NodeId>>,
    /// Il cambio sposta i punti: solo una traslazione spiega un oggetto.
    punti: bool,
    ident: Vec<Value>,
    /// Con il percorso dell'elemento tolto, per ordinarli.
    remove: Vec<(Vec<usize>, Value)>,
    moves: Vec<Value>,
    add: Vec<Value>,
    /// I `move` dentro un gruppo nuovo: dopo il suo `add`.
    dentro: Vec<Value>,
    set: Vec<Value>,
    ids: HashMap<NodeId, String>,
    /// I gruppi nuovi fatti di oggetti di prima, col loro genitore: il
    /// `<g>` non ha `transform`, il suo spazio è quello del genitore.
    gruppi_nuovi: HashMap<NodeId, Option<NodeId>>,
    /// Gli id dati in questo gesto.
    dati: HashSet<String>,
    /// Gli oggetti che si riscrivono interi: l'elemento di prima si toglie e
    /// al suo posto va il corpo espanso con la ricetta nuova.
    riscritti: HashSet<NodeId>,
    /// I testi che si riscrivono interi (anche in `riscritti`): al posto
    /// dell'elemento di prima va il `<text>` con lo stesso id e le righe
    /// nuove (K6 T16).
    testi_riscritti: HashMap<NodeId, TestoRiscritto>,
    /// Le ricette che il gesto scrive o fa cadere.
    ricette: ricetta::Scritte,
    /// I tracciati di un tracciato composto sciolto: c'erano, ma non erano
    /// elementi di Fub (il `<path>` era il composto); si scrivono come nuovi.
    liberati: HashSet<NodeId>,
    /// Gli elementi di Fub finiti dentro un tracciato composto nuovo: si
    /// tolgono, e il composto si scrive come un solo `<path>`.
    assorbiti: HashSet<NodeId>,
    /// Come si scrive un colore legato a un campione.
    riferimenti: Riferimenti,
    /// Le sfumature private nuove del gesto, da aggiungere alla `fub-defs`
    /// prima di chi le usa ([`crate::sfumature`]).
    sfumature: Vec<Value>,
}

impl Lavoro<'_> {
    /// I tracciati composti fatti o sciolti dal gesto ([`Lavoro::liberati`],
    /// [`Lavoro::assorbiti`]).
    fn composti(&mut self, prima: &Posti<'_>, poi: &Posti<'_>) {
        // Un tracciato composto, una forma composta (un gruppo segnato) o una
        // fusione: il file li tiene come un solo elemento con la ricetta.
        let composto = |n: Option<&crate::mappa::Posto<'_>>| {
            n.is_some_and(|p| {
                matches!(
                    p.nodo.kind,
                    NodeKind::Compound { .. } | NodeKind::Blend { .. }
                ) || p.nodo.is_compound_shape()
            })
        };
        for (id, dopo) in &poi.nodi {
            let Some(p) = prima.nodi.get(id) else {
                continue;
            };
            if p.genitore == dopo.genitore {
                continue;
            }
            let di_fub = self.copia.mappa.del_nodo(*id).is_some();
            let nuovo_genitore = dopo.genitore.filter(|g| !prima.nodi.contains_key(g));
            // Le sorgenti di un gruppo del Sagomatore nuovo sono nella sua
            // ricetta, anche quelle che venivano da un gruppo di prima (che
            // nel file non erano elementi). Un elemento del file che va fra
            // le sorgenti di un gruppo di prima (Unisci della Pittura
            // dinamica) entra nella ricetta del gruppo, riscritto.
            let nel_sagomatore =
                in_un_sagomatore(nuovo_genitore, poi, |g| !prima.nodi.contains_key(&g))
                    || (di_fub && fra_le_sorgenti_vive(dopo.genitore, poi));
            // Anche i pezzi di un composto di prima che passano in uno nuovo
            // (una fusione che prende altre chiavi: le sue stanno nella
            // ricetta di quella nuova).
            let da_un_composto = composto(p.genitore.and_then(|g| prima.nodi.get(&g)));
            if nel_sagomatore
                || ((di_fub || da_un_composto)
                    && composto(nuovo_genitore.and_then(|g| poi.nodi.get(&g))))
            {
                self.assorbiti.insert(*id);
            } else if !di_fub
                && (composto(p.genitore.and_then(|g| prima.nodi.get(&g)))
                    || in_un_sagomatore(p.genitore, prima, |_| true))
            {
                self.liberati.insert(*id);
            }
        }
    }

    fn elemento(&self, nodo: NodeId) -> Option<&Elemento> {
        self.copia
            .mappa
            .del_nodo(nodo)
            .and_then(|i| self.copia.mappa.elemento(i))
    }

    /// Vero se l'elemento o un suo antenato è bloccato nel file.
    fn bloccato(&self, e: &Elemento) -> bool {
        let mut corrente = Some(e);
        while let Some(x) = corrente {
            if x.bloccato {
                return true;
            }
            corrente = x.genitore.and_then(|g| self.copia.mappa.elemento(g));
        }
        false
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
            Some(g) if self.gruppi_nuovi.contains_key(&g) => {
                self.matrice_del_genitore(self.gruppi_nuovi[&g])
            }
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
            if self.dentro_un_riscritto(posto.genitore, prima) {
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
            let e = e.clone();
            self.togli(&e);
        }
        for nodo in self.assorbiti.clone() {
            if let Some(e) = self.elemento(nodo).cloned() {
                self.togli(&e);
            }
        }
        for nodo in self.riscritti.clone() {
            let Some(e) = self.elemento(nodo).cloned() else {
                return Err(Rifiuto::NonMappato(format!(
                    "il gesto riscrive l'oggetto {} che non viene da Fub",
                    nodo.0
                )));
            };
            self.togli(&e);
        }
        Ok(())
    }

    /// Il `remove` dell'elemento `e`; le ricette sue e dei suoi discendenti
    /// cadono.
    fn togli(&mut self, e: &Elemento) {
        let bersaglio = match e.id_del_file() {
            Some(id) => json!(id),
            None => json!({ "path": e.percorso, "tag": e.tag }),
        };
        self.remove.push((
            e.percorso.clone(),
            json!({ "op": "remove", "target": bersaglio }),
        ));
        for d in self.copia.mappa.elementi() {
            if d.percorso.starts_with(&e.percorso) {
                if let Some(id) = &d.id {
                    self.ricette.via.insert(id.clone());
                }
            }
        }
    }

    /// Vero se `nodo` o un suo antenato in `posti` si riscrive intero.
    fn dentro_un_riscritto(&self, mut nodo: Option<NodeId>, posti: &Posti<'_>) -> bool {
        while let Some(n) = nodo {
            if self.riscritti.contains(&n) {
                return true;
            }
            nodo = posti.nodi.get(&n).and_then(|p| p.genitore);
        }
        false
    }

    /// L'ordine e il genitore degli oggetti che ci sono prima e dopo: un
    /// `move` per ognuno fuori dalla sottosequenza crescente più lunga dei
    /// fratelli rimasti.
    fn ordine(&mut self, prima: &Posti<'_>, dopo: &Document) -> Result<(), Rifiuto> {
        let mut contenitori: Vec<(Option<NodeId>, &Vec<Arc<Node>>)> = Vec::new();
        fn raccogli<'a>(
            n: &'a Arc<Node>,
            riscritti: &HashSet<NodeId>,
            prima: &Posti<'_>,
            out: &mut Vec<(Option<NodeId>, &'a Vec<Arc<Node>>)>,
        ) {
            if riscritti.contains(&n.id) {
                return;
            }
            // Un tracciato composto o una forma composta nuovi si scrivono
            // interi: i loro pezzi non si spostano dentro di loro.
            let composto = matches!(n.kind, NodeKind::Compound { .. }) || n.is_compound_shape();
            if composto && !prima.nodi.contains_key(&n.id) {
                return;
            }
            if let Some(figli) = n.children() {
                out.push((Some(n.id), figli));
                for c in figli {
                    raccogli(c, riscritti, prima, out);
                }
            }
        }
        // La cima del motore per prima: senza la carta i livelli di Fub
        // sono i livelli in cima, e il loro ordine è quello dei figli della
        // radice.
        contenitori.push((None, &dopo.layers));
        for l in &dopo.layers {
            raccogli(l, &self.riscritti, prima, &mut contenitori);
        }
        for (genitore, figli) in contenitori {
            // Solo i figli che c'erano già; i nuovi e i riscritti li mette
            // `add`.
            let rimasti: Vec<&Arc<Node>> = figli
                .iter()
                .filter(|c| {
                    prima.nodi.contains_key(&c.id)
                        && !self.riscritti.contains(&c.id)
                        && !self.liberati.contains(&c.id)
                        && !self.assorbiti.contains(&c.id)
                })
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
                let parent = match genitore {
                    None => "#root".to_string(),
                    Some(_) => self.genitore(genitore)?,
                };
                let pos = match i.checked_sub(1).and_then(|j| rimasti.get(j)) {
                    Some(prec) => json!({ "after": self.bersaglio(prec.id)? }),
                    None => self.primo_fra(genitore),
                };
                let op = json!({ "op": "move", "target": target, "parent": parent, "pos": pos });
                match genitore {
                    Some(g) if self.gruppi_nuovi.contains_key(&g) => self.dentro.push(op),
                    _ => self.moves.push(op),
                }
            }
        }
        Ok(())
    }

    /// Gli oggetti nuovi: un `add` per il più alto di ognuno.
    fn nuovi(&mut self, prima: &Posti<'_>, dopo: &Document) -> Result<(), Rifiuto> {
        // Un oggetto nuovo: il genitore, i fratelli dopo il gesto, il posto.
        type Nuovo<'a> = (Option<NodeId>, Vec<&'a Arc<Node>>, usize);
        let mut nuovi: Vec<Nuovo<'_>> = Vec::new();
        fn cerca<'a>(
            n: &'a Arc<Node>,
            prima: &Posti<'_>,
            riscritti: &HashSet<NodeId>,
            liberati: &HashSet<NodeId>,
            out: &mut Vec<Nuovo<'a>>,
        ) {
            let Some(figli) = n.children() else { return };
            for (i, c) in figli.iter().enumerate() {
                if prima.nodi.contains_key(&c.id)
                    && !riscritti.contains(&c.id)
                    && !liberati.contains(&c.id)
                {
                    cerca(c, prima, riscritti, liberati, out);
                } else {
                    out.push((Some(n.id), figli.iter().collect(), i));
                }
            }
        }
        for (i, l) in dopo.layers.iter().enumerate() {
            if !prima.nodi.contains_key(&l.id) {
                self.livello_nuovo(dopo, i)?;
                continue;
            }
            cerca(l, prima, &self.riscritti, &self.liberati, &mut nuovi);
        }
        // Lo stampo del corpo espanso, fatto alla prima ricetta del gesto.
        let mut stampo: Option<crate::espansa::Stampo> = None;
        let mut k = 0;
        while k < nuovi.len() {
            let (genitore, fratelli, i) = nuovi[k].clone();
            k += 1;
            let nodo = fratelli[i];
            let parent = self.genitore(genitore)?;
            let locale = self.matrice_del_genitore(genitore)?.inverse();
            if !locale.is_finite() {
                return Err(no("il genitore ha una transform che non si inverte"));
            }
            let riscritto = self.riscritti.contains(&nodo.id);
            if !riscritto && ritagli::ritaglio_nuovo(nodo, prima, &self.assorbiti, &self.riscritti)
            {
                let pos = self.posto(genitore, &fratelli, i)?;
                self.scrivi_ritaglio(nodo, genitore, parent, pos, locale)?;
                continue;
            }
            if !riscritto && gruppo_di_prima(nodo, prima, &self.riscritti) {
                let id = self.id_nuovo(Specie::Oggetto)?;
                self.ids.insert(nodo.id, id.clone());
                self.gruppi_nuovi.insert(nodo.id, genitore);
                let pos = self.posto(genitore, &fratelli, i)?;
                self.add.push(json!({
                    "op": "add", "parent": parent, "pos": pos,
                    "elem": { "tag": "g", "attrs": { "id": id } },
                }));
                continue;
            }
            // Un gruppo semplice nuovo fatto solo di pezzi nuovi (i pezzi che
            // l'Elaborazione tracciati lascia divisi): il `g`, poi ogni pezzo
            // dentro, subito dopo, ciascuno con il suo `add`.
            if !riscritto && gruppo_tutto_nuovo(nodo, prima, &self.copia.mappa) {
                let id = self.id_nuovo(Specie::Oggetto)?;
                self.ids.insert(nodo.id, id.clone());
                self.gruppi_nuovi.insert(nodo.id, genitore);
                let pos = self.posto(genitore, &fratelli, i)?;
                self.add.push(json!({
                    "op": "add", "parent": parent, "pos": pos,
                    "elem": { "tag": "g", "attrs": { "id": id } },
                }));
                if let Some(figli) = nodo.children() {
                    let figli: Vec<&Arc<Node>> = figli.iter().collect();
                    let dentro = (0..figli.len()).map(|j| (Some(nodo.id), figli.clone(), j));
                    nuovi.splice(k..k, dentro);
                }
                continue;
            }
            // Un testo riscritto intero: lo stesso id, gli attributi e le
            // righe nuove.
            if let Some(testo) = self.testi_riscritti.get(&nodo.id).cloned() {
                let id = self
                    .elemento(nodo.id)
                    .and_then(Elemento::id_del_file)
                    .map(str::to_string)
                    .ok_or_else(|| no("un testo senza id non si riscrive"))?;
                let mut attrs = Map::new();
                attrs.insert("id".into(), json!(id));
                attrs.extend(testo.attrs);
                self.ids.insert(nodo.id, id);
                let pos = self.posto(genitore, &fratelli, i)?;
                self.add.push(json!({
                    "op": "add", "parent": parent, "pos": pos,
                    "elem": { "tag": "text", "attrs": attrs, "children": testo.righe },
                }));
                continue;
            }
            // Un oggetto riscritto tiene il suo id se è già della forma nuova.
            let vecchio = riscritto
                .then(|| self.elemento(nodo.id).and_then(Elemento::id_del_file))
                .flatten()
                .filter(|id| id::e_nuovo(id, Specie::Oggetto))
                .map(str::to_string);
            let id = match vecchio {
                Some(id) => id,
                None => self.id_nuovo(Specie::Oggetto)?,
            };
            let scritto = if riscritto {
                None
            } else {
                self.scrittore.and_then(|s| s(nodo, locale))
            };
            // Un oggetto ricco, o uno riscritto, va con il corpo espanso (la
            // grafica che il motore disegna) e la sua ricetta, se nessuno dei
            // suoi pezzi c'era già.
            let con_ricetta = scritto.is_none()
                && (riscritto
                    || (ricetta::esito_albero(nodo) > Esito::Corpo
                        && !ha_pezzi_rimasti(nodo, prima, &self.assorbiti)));
            let elem_o_raw = if con_ricetta {
                let stampo = stampo.get_or_insert_with(|| crate::espansa::Stampo::di(dopo));
                let raw = stampo
                    .corpo(nodo, locale, &id, &mut |specie| {
                        self.id_nuovo(specie).map_err(|e| format!("{e:?}"))
                    })
                    .map_err(no)?
                    .ok_or(Rifiuto::Vuoto)?;
                let byte = ricetta::codifica(nodo, locale).map_err(no)?;
                self.ricette.nuove.push(vectorcraft_svg::recipe_element(
                    &id,
                    &ricetta::impronta(&raw),
                    &byte,
                ));
                self.stato_del_corpo(nodo, riscritto, &id);
                json!({ "raw": raw })
            } else {
                let (tag, mut attrs) = match scritto {
                    Some(e) => e,
                    None => elem(nodo, locale, &self.riferimenti)?,
                };
                attrs.insert("id".into(), json!(id));
                json!({ "elem": { "tag": tag, "attrs": attrs } })
            };
            self.ids.insert(nodo.id, id);
            let pos = self.posto(genitore, &fratelli, i)?;
            let mut op = json!({ "op": "add", "parent": parent, "pos": pos });
            if let (Some(op), Value::Object(corpo)) = (op.as_object_mut(), elem_o_raw) {
                op.extend(corpo);
            }
            self.add.push(op);
        }
        Ok(())
    }

    /// La parte di cui `n` risponde da sé quando si chiede se è ricco. Un
    /// gruppo risponde solo di sé: i suoi oggetti sono elementi del file, e il
    /// confronto scende fino a loro, che si scrivono ognuno per sé (un oggetto
    /// diventato ricco si riscrive con la sua ricetta, il gruppo resta). Ogni
    /// altro contenitore risponde di ciò che contiene, tranne gli oggetti con
    /// una ricetta applicata nel file.
    fn propria(&self, n: &Arc<Node>) -> Arc<Node> {
        if !matches!(n.kind, NodeKind::Group { .. }) {
            return self.senza_ricette(n);
        }
        let mut solo = (**n).clone();
        if let Some(f) = solo.children_mut() {
            f.clear();
        }
        Arc::new(solo)
    }

    /// `n` senza gli oggetti che contiene con una ricetta applicata nel file.
    /// Lo stesso `Arc` se dentro non ce ne sono.
    fn senza_ricette(&self, n: &Arc<Node>) -> Arc<Node> {
        let Some(figli) = n.children() else {
            return n.clone();
        };
        let ricette = self.copia.mappa.ricette();
        let mut cambiato = false;
        let tenuti: Vec<Arc<Node>> = figli
            .iter()
            .filter_map(|c| {
                let con_ricetta = self
                    .elemento(c.id)
                    .and_then(|e| e.id.as_deref())
                    .is_some_and(|id| ricette.applicata(id));
                if con_ricetta {
                    cambiato = true;
                    return None;
                }
                let dentro = self.senza_ricette(c);
                cambiato |= !Arc::ptr_eq(&dentro, c);
                Some(dentro)
            })
            .collect();
        if !cambiato {
            return n.clone();
        }
        let mut copia = (**n).clone();
        if let Some(f) = copia.children_mut() {
            *f = tenuti;
        }
        Arc::new(copia)
    }

    /// Lo stato, nascosto e bloccato, di un oggetto scritto come corpo
    /// espanso con la ricetta: il corpo non lo porta (lo stampo esporta
    /// l'oggetto visibile) e l'impronta non lo conta, quindi va in un `set`
    /// sull'id del corpo, dopo l'`add`. Per un oggetto riscritto prende il
    /// posto del `set` che [`Lavoro::stato`] ha messo sul suo id di prima:
    /// l'elemento di prima se ne va con i suoi attributi, e l'id può essere
    /// nuovo.
    fn stato_del_corpo(&mut self, nodo: &Node, riscritto: bool, id: &str) {
        if riscritto {
            if let Some(prima) = self
                .elemento(nodo.id)
                .and_then(Elemento::id_del_file)
                .map(str::to_string)
            {
                self.set.retain(|op| {
                    let solo_stato = op["attrs"]
                        .as_object()
                        .is_some_and(|a| a.keys().all(|k| k == "display" || k == "fub:locked"));
                    !(op["id"] == prima && solo_stato)
                });
            }
        }
        let mut attrs = Map::new();
        if !nodo.visible {
            attrs.insert("display".into(), json!("none"));
        }
        if nodo.locked {
            attrs.insert("fub:locked".into(), json!("true"));
        }
        if !attrs.is_empty() {
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": attrs }));
        }
    }

    /// Il posto di un oggetto nuovo fra i fratelli di dopo, figli di
    /// `genitore`.
    fn posto(
        &mut self,
        genitore: Option<NodeId>,
        fratelli: &[&Arc<Node>],
        i: usize,
    ) -> Result<Value, Rifiuto> {
        if i + 1 == fratelli.len() {
            return Ok(json!({ "last": true }));
        }
        Ok(match i.checked_sub(1).map(|j| fratelli[j]) {
            Some(prec) => json!({ "after": self.bersaglio(prec.id)? }),
            None => self.primo_fra(genitore),
        })
    }

    /// Il primo posto fra i figli di `genitore`: fra i figli della radice
    /// (la cima del motore o il livello che sta per la radice) è subito
    /// dopo la carta, se il file ne ha una, perché la carta resta sotto ogni
    /// cosa; altrimenti il primo.
    fn primo_fra(&self, genitore: Option<NodeId>) -> Value {
        let radice = genitore.is_none_or(|g| self.copia.mappa.e_radice(g));
        match self.copia.mappa.carta().filter(|_| radice) {
            Some(carta) => json!({ "after": carta }),
            None => json!({ "first": true }),
        }
    }

    /// Bloccato e nascosto: il `set` di `fub:locked` e di `display` se il
    /// motore li ha cambiati, e l'oggetto di prima con lo stato di dopo, per
    /// il resto del confronto. Si scrive ciò che il file non dice già; il
    /// foglio resta bloccato. Un oggetto mostrato che il file nasconde in un
    /// altro modo (uno stile) non si scrive con `display`.
    fn stato(&mut self, b: &Arc<Node>, a: &Arc<Node>) -> Result<Arc<Node>, Rifiuto> {
        if b.visible == a.visible && b.locked == a.locked {
            return Ok(b.clone());
        }
        let Some(e) = self.elemento(a.id).cloned() else {
            return Err(Rifiuto::NonMappato(format!(
                "il gesto blocca o nasconde l'oggetto {} che non viene da Fub",
                a.id.0
            )));
        };
        let mut attrs = Map::new();
        if b.locked != a.locked && e.ruolo != fub_scene::Role::Paper && a.locked != e.bloccato {
            attrs.insert(
                "fub:locked".into(),
                if a.locked { json!("true") } else { Value::Null },
            );
        }
        if b.visible != a.visible {
            if e.ruolo == fub_scene::Role::Paper {
                return Err(no("il foglio di Fub non si nasconde"));
            }
            if a.visible && !e.nascosto {
                return Err(no(
                    "l'oggetto è nascosto da uno stile, che display non toglie",
                ));
            }
            if a.visible == e.nascosto {
                attrs.insert(
                    "display".into(),
                    if a.visible {
                        Value::Null
                    } else {
                        json!("none")
                    },
                );
            }
        }
        if !attrs.is_empty() {
            let id = self.bersaglio(a.id)?;
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": attrs }));
        }
        let mut c = (**b).clone();
        c.visible = a.visible;
        c.locked = a.locked;
        Ok(Arc::new(c))
    }

    /// Un livello di Fub rinominato dal motore: il `set` di `fub:layer` col
    /// nome nuovo, e il livello di prima con quel nome, per il resto del
    /// confronto. `None` se il nome non cambia o se `a` non è un livello di
    /// Fub (il livello che sta per la radice non ha un nome da scrivere, e il
    /// confronto lo rifiuta). Nel motore il livello si chiama col suo id
    /// (la mappa lega per nome): rinominarlo è dargli un nome diverso da quello.
    /// Un nome che il formato non tiene si rifiuta.
    fn nome_del_livello(&mut self, b: &Node, a: &Node) -> Result<Option<Node>, Rifiuto> {
        if b.name == a.name {
            return Ok(None);
        }
        let Some(e) = self
            .elemento(a.id)
            .filter(|e| e.ruolo == fub_scene::Role::Layer)
            .cloned()
        else {
            return Ok(None);
        };
        let nome = a.name.clone().unwrap_or_default();
        if let Some(perche) = crate::mappa::nome_di_livello_sbagliato(&nome) {
            return Err(no(perche));
        }
        if e.livello.as_deref() != Some(nome.as_str()) {
            let id = self.bersaglio(a.id)?;
            self.set
                .push(json!({ "op": "set", "id": id, "attrs": { "fub:layer": nome } }));
        }
        let mut c = b.clone();
        c.name = a.name.clone();
        Ok(Some(c))
    }

    /// Un livello nuovo del motore in cima al documento: un `<g>` figlio della
    /// radice con un id di livello nuovo e `fub:layer` col nome del motore
    /// (formato della scena §3), al suo posto fra i livelli. Si scrive solo un
    /// livello vuoto, nascosto o bloccato al più: ciò che il formato non dice
    /// (il modello, la stampa, l'anteprima, le immagini sbiadite, una
    /// maschera) si rifiuta. Il colore del motore non si scrive: il formato
    /// non lo ha, e il motore ne dà uno a ogni livello nuovo.
    fn livello_nuovo(&mut self, dopo: &Document, i: usize) -> Result<(), Rifiuto> {
        let l = &dopo.layers[i];
        let NodeKind::Layer {
            children,
            clip,
            template,
            printable,
            preview,
            dim_images,
            ..
        } = &l.kind
        else {
            return Err(no("il gesto crea in cima un oggetto che non è un livello"));
        };
        if !children.is_empty() {
            return Err(no("il gesto crea un livello con qualcosa dentro"));
        }
        if *clip || *template || !*printable || !*preview || dim_images.is_some() {
            return Err(no(
                "il livello nuovo ha opzioni che il formato della scena non ha",
            ));
        }
        let nome = l.name.clone().unwrap_or_default();
        if let Some(perche) = crate::mappa::nome_di_livello_sbagliato(&nome) {
            return Err(no(perche));
        }
        // Il posto: dopo il livello che gli sta sotto; il primo dei livelli va
        // dopo l'elemento che precede il primo livello del file.
        let pos = if i + 1 == dopo.layers.len() {
            json!({ "last": true })
        } else if let Some(sotto) = i.checked_sub(1).map(|j| dopo.layers[j].id) {
            if self.copia.mappa.e_radice(sotto) {
                return Err(no(
                    "un livello nuovo fra gli elementi fuori da ogni livello non ha un posto nel file",
                ));
            }
            json!({ "after": self.bersaglio(sotto)? })
        } else {
            let primo = dopo.layers[i + 1].id;
            let e = self.elemento(primo).cloned().ok_or_else(|| {
                no("un livello nuovo sotto gli elementi fuori da ogni livello non ha un posto nel file")
            })?;
            let indice = e.percorso.first().copied().unwrap_or(0);
            let prima_di_lui = indice.checked_sub(1).and_then(|k| {
                self.copia
                    .mappa
                    .elementi()
                    .iter()
                    .find(|x| x.percorso == [k])
            });
            match self
                .copia
                .mappa
                .carta()
                .or_else(|| prima_di_lui.and_then(Elemento::id_del_file))
            {
                Some(id) => json!({ "after": id }),
                None if indice == 0 => json!({ "first": true }),
                None => {
                    return Err(no(
                        "un livello nuovo sotto tutti gli altri non ha un posto da scrivere",
                    ))
                }
            }
        };
        let id = self.id_nuovo(Specie::Livello)?;
        self.ids.insert(l.id, id.clone());
        let mut attrs = Map::new();
        attrs.insert("id".into(), json!(id));
        attrs.insert("fub:layer".into(), json!(nome));
        if l.locked {
            attrs.insert("fub:locked".into(), json!("true"));
        }
        if !l.visible {
            attrs.insert("display".into(), json!("none"));
        }
        self.add.push(json!({
            "op": "add", "parent": "#root", "pos": pos,
            "elem": { "tag": "g", "attrs": attrs, "children": [] },
        }));
        Ok(())
    }

    /// Gli oggetti che ci sono prima e dopo, dall'alto: i `set`.
    fn confronta(
        &mut self,
        b: &Arc<Node>,
        a: &Arc<Node>,
        prima: &Posti<'_>,
    ) -> Result<(), Rifiuto> {
        if uguali(b, a) {
            return Ok(());
        }
        let b = &self.stato(b, a)?;
        if uguali(b, a) {
            return Ok(());
        }
        let radice = self.copia.mappa.e_radice(a.id);
        let livello = matches!(a.kind, NodeKind::Layer { .. })
            || self
                .elemento(a.id)
                .is_some_and(|e| e.ruolo == fub_scene::Role::Layer);
        let oggetto = if radice || livello {
            None
        } else {
            self.elemento(a.id).cloned()
        };
        if let Some(e) = oggetto {
            let con_ricetta =
                e.id.as_deref()
                    .is_some_and(|id| self.copia.mappa.ricette().applicata(id));
            if con_ricetta {
                // Spostato, ruotato o scalato: cambia solo la sua `transform`
                // e la ricetta resta. Ogni altro cambio lo riscrive intero.
                if let Some(m) = self.adatta(b, a) {
                    if mosso_da(b, m, true).is_some_and(|c| nodi_vicini(&c, a)) {
                        if !vicina_all_identita(m) {
                            let t = nuova_trasformazione(&e, m)?;
                            let id = self.bersaglio(a.id)?;
                            self.set.push(json!({ "op": "set", "id": id, "attrs": { "transform": scrivi_matrice(t) } }));
                        }
                        return Ok(());
                    }
                }
                self.riscritti.insert(a.id);
                return Ok(());
            }
            // Gli oggetti di un gruppo, e quelli con una ricetta loro, non
            // fanno ricco questo: il confronto scende fino a loro, e ognuno si
            // scrive per sé (spostato, o riscritto con la sua ricetta).
            let (propria_a, propria_b) = (self.propria(a), self.propria(b));
            if ricetta::esito_albero(&propria_a) > Esito::Corpo {
                // Ricco. Se i suoi costrutti cambiano, gli attributi non li
                // direbbero: si riscrive intero con la sua ricetta. Il
                // tratteggio semplice fa eccezione: `stroke-dasharray` lo
                // dice, e `foglia` lo scrive (o rifiuta, e si riscrive).
                if costrutti_non_detti(&propria_a) != costrutti_non_detti(&propria_b) {
                    self.riscritti.insert(a.id);
                    return Ok(());
                }
                // Gli stessi di prima: se il cambio non si scrive come
                // attributi, si riscrive intero.
                let prima_del_tentativo = (
                    self.ident.len(),
                    self.set.len(),
                    self.ids.clone(),
                    self.dati.clone(),
                    self.riscritti.clone(),
                    self.sfumature.len(),
                );
                match self.confronta_comune(b, a, prima, radice, livello) {
                    Ok(()) => return Ok(()),
                    Err(_) => {
                        let (ident, set, ids, dati, riscritti, sfumature) = prima_del_tentativo;
                        self.ident.truncate(ident);
                        self.set.truncate(set);
                        self.sfumature.truncate(sfumature);
                        self.ids = ids;
                        self.dati = dati;
                        self.riscritti = riscritti;
                        self.riscritti.insert(a.id);
                        return Ok(());
                    }
                }
            }
        }
        self.confronta_comune(b, a, prima, radice, livello)
    }

    /// Il confronto di un oggetto che non si riscrive intero.
    fn confronta_comune(
        &mut self,
        b: &Arc<Node>,
        a: &Arc<Node>,
        prima: &Posti<'_>,
        radice: bool,
        livello: bool,
    ) -> Result<(), Rifiuto> {
        if let Some(attrs) = self.composto_cambiato(b, a)? {
            if !attrs.is_empty() {
                let id = self.bersaglio(a.id)?;
                self.set
                    .push(json!({ "op": "set", "id": id, "attrs": attrs }));
            }
            return Ok(());
        }
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
                let attrs = self.foglia_scritta(&e, b, a)?;
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
            // gruppo e il gruppo è un oggetto scelto dal gesto, come la
            // scrive il client. Senza la scelta, quando scriverla sui figli
            // non basta o costa di più: un figlio che non viene da Fub, o più
            // d'un figlio; con un figlio solo di Fub la riceve il figlio.
            let gruppo = !radice && !livello && self.elemento(a.id).is_some();
            let per_il_gruppo = match self.unita {
                Some(unita) => unita.contains(&a.id),
                None => figli.len() > 1 || figli.iter().any(|c| self.ha_estranei(c)),
            };
            if gruppo && per_il_gruppo {
                if let Some(m) = self.adatta(b, a) {
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
            let rinominato;
            let b: &Node = match self.nome_del_livello(b, a)? {
                Some(c) => {
                    rinominato = c;
                    &rinominato
                }
                None => b,
            };
            let sciolto;
            let b: &Node = match self.ritaglio_tolto(b, a)? {
                Some(c) => {
                    sciolto = c;
                    &sciolto
                }
                None => b,
            };
            if !proprieta_uguali(b, a) {
                return Err(no(
                    "cambia un gruppo o un livello in un modo che non si scrive",
                ));
            }
            self.confronta_figli(figli, prima)?;
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
        // Un testo di punto con altre parole, un altro carattere o un altro
        // allineamento (K6 T16): il resto del confronto va avanti sul testo
        // di prima che li ha già.
        if da_riscrivere(b, a) {
            let riscritto = riscrittura(&e, b, a)?;
            self.testi_riscritti.insert(a.id, riscritto);
            self.riscritti.insert(a.id);
            return Ok(());
        }
        let (b, mut attrs, righe) = match testo_cambiato(&e, b, a)? {
            Some(cambio) => (Arc::new(cambio.prima), cambio.attrs, cambio.righe),
            None => (b.clone(), Map::new(), None),
        };
        attrs.extend(self.foglia_scritta(&e, &b, a)?);
        if !attrs.is_empty() || righe.is_some() {
            let id = self.bersaglio(a.id)?;
            // Un `d` su una forma che non è un tracciato vuol dire che la
            // forma è stata deformata e diventa un tracciato ([`Lavoro::foglia`]).
            let diventa = e.tag != "path" && attrs.contains_key("d");
            if diventa {
                self.set
                    .push(json!({ "op": "set", "id": id, "tag": "path", "attrs": attrs }));
            } else if !attrs.is_empty() {
                self.set
                    .push(json!({ "op": "set", "id": id, "attrs": attrs }));
            }
            if let Some(righe) = righe {
                self.set
                    .push(json!({ "op": "text", "id": id, "lines": righe }));
            }
        }
        Ok(())
    }

    /// Un `<path>` composto di prima (i suoi tracciati non sono elementi di
    /// Fub) di cui cambiano solo i sottotracciati (il verso, punti aggiunti):
    /// il `d` nuovo. Una regola di riempimento cambiata si rifiuta
    /// ([`REGOLA_FUORI`]). `None` se il cambio è un altro, che il resto del
    /// confronto scrive o rifiuta.
    fn composto_cambiato(&self, b: &Node, a: &Node) -> Result<Option<Map<String, Value>>, Rifiuto> {
        let (Some((pb, rb)), Some((pa, ra))) = (tracciato_composto(b), tracciato_composto(a))
        else {
            return Ok(None);
        };
        let estranei = |n: &Node| {
            n.children().is_some_and(|figli| {
                figli
                    .iter()
                    .all(|c| self.copia.mappa.del_nodo(c.id).is_none())
            })
        };
        let Some(e) = self
            .elemento(a.id)
            .filter(|e| e.tag == "path" && estranei(b) && estranei(a))
        else {
            return Ok(None);
        };
        let con_la_stessa_regola = |n: &Node| {
            let mut c = senza_figli(n);
            if let NodeKind::Compound { rule, .. } = &mut c.kind {
                *rule = FillRule::NonZero;
            }
            c
        };
        if !nodi_vicini(&con_la_stessa_regola(b), &con_la_stessa_regola(a)) {
            return Ok(None);
        }
        let mut attrs = Map::new();
        if !json_vicini(
            &serde_json::to_value(&pb).unwrap_or(Value::Null),
            &serde_json::to_value(&pa).unwrap_or(Value::Null),
        ) {
            let g = e
                .ctm_genitore
                .ok_or_else(|| no("una transform di un antenato non si legge"))?;
            let t = e
                .propria
                .ok_or_else(|| no("la transform dell'elemento non si legge"))?;
            let locale = (g * t).inverse();
            if !locale.is_finite() {
                return Err(no("l'elemento ha una transform che non si inverte"));
            }
            attrs.insert("d".into(), json!(scrivi_d(&trasformato(&pa, locale))));
        }
        if rb != ra {
            return Err(no(REGOLA_FUORI));
        }
        Ok(Some(attrs))
    }

    /// I figli che c'erano già, e quelli di un gruppo nuovo che li raccoglie.
    fn confronta_figli(&mut self, figli: &[Arc<Node>], prima: &Posti<'_>) -> Result<(), Rifiuto> {
        for c in figli {
            if self.liberati.contains(&c.id) || self.assorbiti.contains(&c.id) {
                continue;
            }
            match prima.nodi.get(&c.id) {
                Some(p) => self.confronta(p.nodo, c, prima)?,
                None => {
                    if let Some(nipoti) = c.children() {
                        self.confronta_figli(nipoti, prima)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Vero se `n` o un suo discendente non viene da un elemento di Fub.
    fn ha_estranei(&self, n: &Node) -> bool {
        self.copia.mappa.del_nodo(n.id).is_none()
            || n.children()
                .is_some_and(|c| c.iter().any(|c| self.ha_estranei(c)))
    }

    /// [`Lavoro::foglia`], con le sfumature nuove scritte: ognuna ha il suo
    /// id, va fra le [`Lavoro::sfumature`] e chi la usa scrive
    /// `url(#id) ripiego`.
    fn foglia_scritta(
        &mut self,
        e: &Elemento,
        b: &Node,
        a: &Node,
    ) -> Result<Map<String, Value>, Rifiuto> {
        let (mut attrs, nuove) = self.foglia(e, b, a)?;
        for (canale, s) in nuove {
            let id = self.id_nuovo(Specie::Risorsa)?;
            attrs.insert(canale.into(), json!(format!("url(#{id}) {}", s.ripiego)));
            self.sfumature.push(s.elem(&id));
        }
        Ok(attrs)
    }

    /// Gli attributi cambiati di un oggetto senza figli, e le sfumature
    /// nuove del riempimento (`fill`) o del contorno (`stroke`), ancora
    /// senza id ([`Lavoro::foglia_scritta`]).
    /// La matrice che porta `b` su `a` ([`adatta`]); con un cambio dei punti
    /// solo se è una traslazione.
    fn adatta(&self, b: &Node, a: &Node) -> Option<Affine> {
        adatta(b, a).filter(|m| !self.punti || traslazione(*m))
    }

    fn foglia(&self, e: &Elemento, b: &Node, a: &Node) -> Result<AttributiDellaFoglia, Rifiuto> {
        let mut attrs = Map::new();
        let mut nuove = Vec::new();
        let g = e
            .ctm_genitore
            .ok_or_else(|| no("una transform di un antenato non si legge"))?;
        let t = e
            .propria
            .ok_or_else(|| no("la transform dell'elemento non si legge"))?;
        // Un oggetto bloccato (lui o un antenato) tiene il ripiego di un
        // campione che cambia colore: il riferimento lo ridipinge comunque.
        let bloccato = self.bloccato(e);
        let r = &self.riferimenti;
        let da_scrivere = |prima: Option<&Paint>, dopo: Option<&Paint>| {
            !(r.uguali(prima, dopo) || (bloccato && r.stesso_campione(prima, dopo)))
        };
        // Il riempimento di un testo cambiato nei pezzi del motore è il
        // `fill` del `<text>`: il confronto va avanti col testo di prima già
        // ricolorato.
        let ricolorato = riempimento_dei_pezzi(b, a)?;
        let b = match &ricolorato {
            Some((testo, prima, colore)) => {
                if da_scrivere(Some(prima), Some(colore)) {
                    attrs.insert("fill".into(), json!(scrivi_colore(r, Some(colore))?));
                }
                testo
            }
            None => b,
        };
        // Una matrice che schiaccia (Media che allinea tutti i punti su una
        // retta) non è uno spostamento: il tracciato si riscrive col suo `d`.
        let m = self
            .adatta(b, a)
            .filter(|m| m.determinant().abs() > 1e-9)
            .unwrap_or(Affine::IDENTITY);
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
            // Un tratto della penna di Fub (`fub:ink`): la sua forma viene dai
            // campioni, e un `d` nuovo li smentirebbe. Lo si sposta, gira o
            // ridimensiona (la `transform` qui sopra), e niente altro (K5).
            if matches!(e.ruolo, fub_scene::Role::Stroke | fub_scene::Role::Width) {
                return Err(no(
                    "un tratto della penna si sposta, gira o ridimensiona, ma i suoi punti non si cambiano",
                ));
            }
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
        } else if let (
            NodeKind::Path { rule: rb, .. },
            NodeKind::Path {
                path: pa, rule: ra, ..
            },
            Some(geometria),
        ) = (&b.kind, &a.kind, geometria_della_forma(e))
        {
            // Una forma semplice deformata (Trasformazione libera con Ctrl,
            // Selezione diretta): come in VectorCraft diventa un tracciato.
            // Il `set` con `tag` la riscrive al suo posto, con gli stessi
            // attributi meno la geometria di prima (scene-operations, «Il
            // tipo di una forma»).
            if rb != ra {
                return Err(no(REGOLA_FUORI));
            }
            let locale = (g * t).inverse();
            if !locale.is_finite() {
                return Err(no("l'elemento ha una transform che non si inverte"));
            }
            for chiave in geometria {
                attrs.insert((*chiave).into(), Value::Null);
            }
            attrs.insert("d".into(), json!(scrivi_d(&trasformato(pa, locale))));
            let mut c = b.clone();
            c.kind = a.kind.clone();
            c.bbox_angle = a.bbox_angle;
            if !geometrie_vicine(&c, a) {
                return Err(no("la forma cambia anche in altro"));
            }
            c
        } else {
            return Err(no(format!(
                "<{}> cambia in un modo che i suoi attributi non dicono",
                e.tag
            )));
        };
        if aspetti_vicini(&candidato.appearance, &a.appearance) {
            return Ok((attrs, nuove));
        }
        // Lo spessore che non segue la scala, i colori pieni.
        let (prima, dopo) = senza_colori_nuovi(&candidato.appearance, &a.appearance);
        if !aspetti_vicini(&prima, &dopo) {
            return Err(no(
                "cambia l'aspetto in un modo che fill, stroke e stroke-width non dicono",
            ));
        }
        // Una sfumatura si scrive nelle coordinate dell'elemento dopo il
        // gesto; quella di prima, portata dal gesto, si confronta scritta
        // allo stesso modo, così uno spostamento non la riscrive.
        let locale = (g * t_nuova).inverse();
        let sfumatura = |p: Option<&Paint>,
                         limiti: Option<vectorcraft_geom::Rect>|
         -> Result<Option<sfumature::Scritta>, Rifiuto> {
            let Some(Paint::Gradient(gp)) = p else {
                return Ok(None);
            };
            let limiti = limiti.ok_or_else(|| no("una sfumatura su un oggetto senza misura"))?;
            sfumature::scritta(gp, limiti, locale)
                .map(Some)
                .ok_or_else(|| no("una sfumatura che la scena non dice"))
        };
        let (gb, ga) = (candidato.geometric_bounds(), a.geometric_bounds());
        let (fb, fa) = (
            candidato.appearance.fill().map(|f| &f.paint),
            a.appearance.fill().map(|f| &f.paint),
        );
        let (sfb, sfa) = (sfumatura(fb, gb)?, sfumatura(fa, ga)?);
        match sfa {
            Some(s) if sfb.as_ref() != Some(&s) => nuove.push(("fill", s)),
            Some(_) => {}
            None if da_scrivere(fb, fa) => {
                attrs.insert("fill".into(), json!(scrivi_colore(r, fa)?));
            }
            None => {}
        }
        let (sb, sa) = (candidato.appearance.stroke(), a.appearance.stroke());
        let (pb, pa) = (sb.map(|s| &s.paint), sa.map(|s| &s.paint));
        if sa.is_some_and(|s| {
            matches!(s.paint, Paint::Gradient(_)) && !sfumature::del_tratto_scrivibile(s)
        }) {
            return Err(no("una sfumatura che segue il tratto"));
        }
        let (stb, sta) = (
            sfumatura(pb, gb.zip(sb).map(|(g, s)| s.paint_bounds(g)))?,
            sfumatura(pa, ga.zip(sa).map(|(g, s)| s.paint_bounds(g)))?,
        );
        match sta {
            Some(s) if stb.as_ref() != Some(&s) => nuove.push(("stroke", s)),
            Some(_) => {}
            None if da_scrivere(pb, pa) => {
                attrs.insert("stroke".into(), json!(scrivi_colore(r, pa)?));
            }
            None => {}
        }
        let (wb, wa) = (sb.map_or(0.0, |s| s.width), sa.map_or(0.0, |s| s.width));
        let scala = (g * t_nuova).determinant().abs().sqrt();
        if !vicini(wb, wa) {
            if scala <= 0.0 || !scala.is_finite() {
                return Err(no("lo spessore non si scrive in uno spazio schiacciato"));
            }
            attrs.insert(
                "stroke-width".into(),
                json!(numero(wa / scala, DECIMALI_GEOMETRIA)),
            );
        }
        scrivi_stile_del_tratto(sb, sa, scala, &mut attrs)?;
        Ok((attrs, nuove))
    }
}

/// Vero se `n` è un gruppo nuovo semplice (nessuna proprietà sua: niente
/// opacità, maschera, nome, aspetto) fatto solo di oggetti che c'erano già e
/// non si riscrivono: Raggruppa.
fn gruppo_di_prima(n: &Node, prima: &Posti<'_>, riscritti: &HashSet<NodeId>) -> bool {
    let NodeKind::Group {
        children,
        clip: false,
    } = &n.kind
    else {
        return false;
    };
    !children.is_empty()
        && children
            .iter()
            .all(|c| prima.nodi.contains_key(&c.id) && !riscritti.contains(&c.id))
        && proprieta_uguali(
            n,
            &Node::new(
                n.id,
                NodeKind::Group {
                    children: Vec::new(),
                    clip: false,
                },
            ),
        )
}

/// Vero per un gruppo semplice (senza ritaglio, senza proprietà sue) che
/// tiene solo oggetti nuovi, nessuno dei quali c'era prima: si scrive come
/// un `g` vuoto e i suoi pezzi dentro.
///
/// Il nome che il motore copia da un oggetto della copia (Crea profili dà al
/// gruppo dei contorni il nome del testo, che è il suo id nel file) non è una
/// proprietà del gruppo: il gruppo prende un id nuovo.
fn gruppo_tutto_nuovo(n: &Node, prima: &Posti<'_>, mappa: &Mappa) -> bool {
    let senza_nome;
    let n = match &n.name {
        Some(nome) if mappa.dell_id(nome).is_some() => {
            let mut c = n.clone();
            c.name = None;
            senza_nome = c;
            &senza_nome
        }
        _ => n,
    };
    let NodeKind::Group {
        children,
        clip: false,
    } = &n.kind
    else {
        return false;
    };
    !children.is_empty()
        && children
            .iter()
            .all(|c| !prima.nodi.contains_key(&c.id) && !ha_pezzi_di_prima(c, prima))
        && proprieta_uguali(
            n,
            &Node::new(
                n.id,
                NodeKind::Group {
                    children: Vec::new(),
                    clip: false,
                },
            ),
        )
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
pub(crate) fn sottosequenza_crescente(chiavi: &[Option<usize>]) -> HashSet<usize> {
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

/// `m` sposta soltanto: la parte lineare è l'identità.
fn traslazione(m: Affine) -> bool {
    let [a, b, c, d, _, _] = m.as_coeffs();
    vicini(a, 1.0) && vicini(b, 0.0) && vicini(c, 0.0) && vicini(d, 1.0)
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

/// Due oggetti uguali, con i sottoalberi condivisi presi per uguali senza
/// guardarli: dopo un gesto il documento del motore condivide con la copia
/// tutti i rami che il gesto non ha toccato, e confrontarli uno per uno
/// costerebbe quanto il disegno.
fn uguali(b: &Arc<Node>, a: &Arc<Node>) -> bool {
    if Arc::ptr_eq(b, a) {
        return true;
    }
    match (b.children(), a.children()) {
        (Some(fb), Some(fa)) => {
            fb.len() == fa.len()
                && senza_figli(b) == senza_figli(a)
                && fb.iter().zip(fa).all(|(x, y)| uguali(x, y))
        }
        _ => **b == **a,
    }
}

/// Il nodo con la lista dei figli vuota: le sue proprietà, senza copiare né
/// scrivere il sottoalbero.
fn senza_figli(n: &Node) -> Node {
    let mut solo = n.clone();
    if let Some(figli) = solo.children_mut() {
        figli.clear();
    }
    solo
}

/// Le proprietà di un contenitore, i figli a parte. Il JSON si scrive dal
/// nodo senza figli ([`senza_figli`]): su un livello, scriverli vorrebbe
/// dire scrivere tutto il disegno per poi buttarlo.
fn proprieta_uguali(a: &Node, b: &Node) -> bool {
    let senza = |n: &Node| {
        let mut v = match n.children() {
            Some(_) => in_json(&senza_figli(n)),
            None => in_json(n),
        };
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
fn riempimento_dei_pezzi(b: &Node, a: &Node) -> Result<Option<(Node, Paint, Paint)>, Rifiuto> {
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
    let (Some(prima), Some(colore)) = (unico(&tb.runs), unico(&ta.runs)) else {
        return Err(no("i pezzi del testo hanno colori diversi"));
    };
    let mut ricolorato = b.clone();
    if let NodeKind::Text(t) = &mut ricolorato.kind {
        for r in &mut t.runs {
            r.style.fill = colore.clone();
        }
    }
    Ok(Some((ricolorato, prima, colore)))
}

/// L'aspetto senza il colore del riempimento, quello del tratto, lo
/// spessore, gli estremi, gli angoli e il tratteggio semplice: ciò che
/// `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin` e
/// `stroke-dasharray` dicono. Un tratteggio spostato o allineato agli angoli
/// resta: la scena non ha un attributo per dirlo.
fn senza_colori(a: &Appearance) -> Appearance {
    let mut a = a.clone();
    if let Some(f) = a.fill_mut() {
        f.paint = Paint::None;
    }
    if let Some(s) = a.stroke_mut() {
        s.paint = Paint::None;
        s.width = 0.0;
        s.cap = LineCap::default();
        s.join = LineJoin::default();
        if s.dash.as_ref().is_none_or(tratteggio_semplice) {
            s.dash = None;
        }
    }
    a
}

/// I costrutti di `n` e del suo albero che gli attributi di una foglia non
/// dicono: tutti tranne il tratteggio semplice (`stroke-dasharray`) e la
/// sfumatura lineare o radiale che la scena scrive come risorsa privata
/// ([`crate::sfumature`]). Un tratteggio spostato o adattato agli angoli, e
/// una sfumatura libera o che segue il tratto, restano costrutti della
/// ricetta.
fn costrutti_non_detti(n: &Node) -> Vec<ricetta::Costrutto> {
    fn tratteggio_ricco(n: &Node) -> bool {
        n.appearance.items.iter().any(|item| match item {
            vectorcraft_doc::AppearanceItem::Stroke(s) => {
                s.dash.as_ref().is_some_and(|d| !tratteggio_semplice(d))
            }
            _ => false,
        }) || n
            .children()
            .into_iter()
            .flatten()
            .any(|c| tratteggio_ricco(c))
    }
    fn sfumatura_ricca(n: &Node) -> bool {
        let ricca = |p: &Paint| matches!(p, Paint::Gradient(g) if !sfumature::scrivibile(g));
        n.appearance.items.iter().any(|item| match item {
            vectorcraft_doc::AppearanceItem::Fill(f) => ricca(&f.paint),
            vectorcraft_doc::AppearanceItem::Stroke(s) => {
                ricca(&s.paint) || !sfumature::del_tratto_scrivibile(s)
            }
        }) || n
            .children()
            .into_iter()
            .flatten()
            .any(|c| sfumatura_ricca(c))
    }
    let mut c = ricetta::costrutti_albero(n);
    if !tratteggio_ricco(n) {
        c.retain(|c| *c != ricetta::Costrutto::Tratteggio);
    }
    if !sfumatura_ricca(n) {
        c.retain(|c| *c != ricetta::Costrutto::Sfumatura);
    }
    c
}

/// Un tratteggio che `stroke-dasharray` dice: senza spostamento e con le
/// lunghezze esatte, non adattate agli angoli.
fn tratteggio_semplice(d: &vectorcraft_doc::Dash) -> bool {
    d.offset == 0.0 && !d.align_corners
}

/// Gli estremi, gli angoli e il tratteggio del tratto in cima, prima e dopo,
/// come attributi della scena: solo quelli cambiati, e `null` per tornare al
/// valore di SVG (`butt`, `miter`, nessun tratteggio). Le lunghezze del
/// tratteggio stanno nel documento del motore e tornano nello spazio
/// dell'elemento con la sua `scala`, come lo spessore.
fn scrivi_stile_del_tratto(
    prima: Option<&vectorcraft_doc::StrokeLayer>,
    dopo: Option<&vectorcraft_doc::StrokeLayer>,
    scala: f64,
    attrs: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    let cap = |s: Option<&vectorcraft_doc::StrokeLayer>| s.map_or(LineCap::default(), |s| s.cap);
    let join = |s: Option<&vectorcraft_doc::StrokeLayer>| s.map_or(LineJoin::default(), |s| s.join);
    if cap(prima) != cap(dopo) {
        let valore = match cap(dopo) {
            LineCap::Butt => Value::Null,
            LineCap::Round => json!("round"),
            LineCap::Square => json!("square"),
        };
        attrs.insert("stroke-linecap".into(), valore);
    }
    if join(prima) != join(dopo) {
        let valore = match join(dopo) {
            LineJoin::Miter => Value::Null,
            LineJoin::Round => json!("round"),
            LineJoin::Bevel => json!("bevel"),
        };
        attrs.insert("stroke-linejoin".into(), valore);
    }
    // Un tratteggio che non disegna trattini (vuoto, tutto a zero) è un
    // tratto pieno, come per SVG.
    let trattini = |s: Option<&vectorcraft_doc::StrokeLayer>| -> Option<Vec<f64>> {
        s.and_then(|s| s.dash.as_ref())
            .filter(|d| d.is_dashed())
            .map(|d| d.pattern.clone())
    };
    let (tb, ta) = (trattini(prima), trattini(dopo));
    let uguali = match (&tb, &ta) {
        (None, None) => true,
        (Some(b), Some(a)) => b.len() == a.len() && b.iter().zip(a).all(|(x, y)| vicini(*x, *y)),
        _ => false,
    };
    if !uguali {
        let valore = match ta {
            None => Value::Null,
            Some(lunghezze) => {
                if scala <= 0.0 || !scala.is_finite() {
                    return Err(no("il tratteggio non si scrive in uno spazio schiacciato"));
                }
                let parole: Vec<String> = lunghezze
                    .iter()
                    .map(|l| numero(l / scala, DECIMALI_GEOMETRIA))
                    .collect();
                json!(parole.join(" "))
            }
        };
        attrs.insert("stroke-dasharray".into(), valore);
    }
    Ok(())
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
pub(crate) fn scrivi_d(p: &vectorcraft_geom::PathData) -> String {
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

/// Vero se un discendente di `n` c'era già prima del gesto: allora `n` non
/// si scrive come grafica nuova, i suoi pezzi sono elementi del file.
fn ha_pezzi_di_prima(n: &Node, prima: &Posti<'_>) -> bool {
    n.children().is_some_and(|figli| {
        figli
            .iter()
            .any(|c| prima.nodi.contains_key(&c.id) || ha_pezzi_di_prima(c, prima))
    })
}

/// Vero se `genitore` è un gruppo del Sagomatore, o sta dentro uno (le
/// sorgenti stanno nel gruppo «Shaper Sources» del gruppo), salendo solo per i
/// gruppi che `vale` accetta: il file tiene il gruppo come un solo elemento con
/// la ricetta, e le sorgenti non sono elementi suoi.
fn in_un_sagomatore(
    mut genitore: Option<NodeId>,
    posti: &Posti<'_>,
    vale: impl Fn(NodeId) -> bool,
) -> bool {
    while let Some(g) = genitore.filter(|g| vale(*g)) {
        let Some(p) = posti.nodi.get(&g) else {
            return false;
        };
        if p.nodo.extras().shaper.is_some() || vectorcraft_tools::builder::is_live_paint(p.nodo) {
            return true;
        }
        genitore = p.genitore;
    }
    false
}

/// Vero se `genitore` è il gruppo delle sorgenti di un gruppo della Pittura
/// dinamica: un elemento che ci finisce (Unisci) non è più un elemento del
/// file, ma una sorgente nella ricetta del gruppo.
fn fra_le_sorgenti_vive(genitore: Option<NodeId>, posti: &Posti<'_>) -> bool {
    use vectorcraft_tools::builder::{is_live_paint, SOURCES_NAME};
    genitore
        .and_then(|g| posti.nodi.get(&g))
        .filter(|p| p.nodo.name.as_deref() == Some(SOURCES_NAME))
        .and_then(|p| p.genitore)
        .and_then(|g| posti.nodi.get(&g))
        .is_some_and(|p| is_live_paint(p.nodo))
}

/// Come [`ha_pezzi_di_prima`], senza i pezzi assorbiti in un composto nuovo
/// (e ciò che hanno dentro): quelli si tolgono dal file, e il composto li
/// porta nella sua ricetta.
fn ha_pezzi_rimasti(n: &Node, prima: &Posti<'_>, assorbiti: &HashSet<NodeId>) -> bool {
    n.children().is_some_and(|figli| {
        figli
            .iter()
            .filter(|c| !assorbiti.contains(&c.id))
            .any(|c| prima.nodi.contains_key(&c.id) || ha_pezzi_rimasti(c, prima, assorbiti))
    })
}

/// Il valore di `fill` o `stroke`: un colore, `none`, o un campione del file
/// col suo ripiego ([`Riferimenti::scrivi`]).
fn scrivi_colore(r: &Riferimenti, p: Option<&Paint>) -> Result<String, Rifiuto> {
    r.scrivi(p)
        .ok_or_else(|| no("un colore che non è pieno (sfumatura, motivo)"))
}

/// L'`Elem` comune di un oggetto nuovo, nello spazio del genitore (`locale`
/// porta dal documento del motore lì): `rect`, `ellipse` e `line` quando la
/// forma lo è ancora dopo il passaggio, altrimenti `path`.
fn elem(
    n: &Node,
    locale: Affine,
    r: &Riferimenti,
) -> Result<(String, Map<String, Value>), Rifiuto> {
    // Un tracciato composto fatto di tracciati: un solo `<path>` con tutti i
    // sottotracciati, come lo legge la scena.
    if let Some((path, regola)) = tracciato_composto(n) {
        let mut attrs = Map::new();
        attrs.insert("d".into(), json!(scrivi_d(&trasformato(&path, locale))));
        if regola != FillRule::NonZero {
            return Err(no(REGOLA_FUORI));
        }
        scrivi_aspetto(n, locale, "path", r, &mut attrs)?;
        return Ok(("path".to_string(), attrs));
    }
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
    scrivi_aspetto(n, locale, tag, r, &mut attrs)?;
    Ok((tag.to_string(), attrs))
}

/// Il riempimento e il tratto di un oggetto nuovo, come li scrive il client.
fn scrivi_aspetto(
    n: &Node,
    locale: Affine,
    tag: &str,
    r: &Riferimenti,
    attrs: &mut Map<String, Value>,
) -> Result<(), Rifiuto> {
    let fill = n.appearance.fill().map(|f| &f.paint);
    if tag != "line" || !matches!(fill, None | Some(Paint::None)) {
        attrs.insert("fill".into(), json!(scrivi_colore(r, fill)?));
    }
    if let Some(s) = n
        .appearance
        .stroke()
        .filter(|s| !matches!(s.paint, Paint::None))
    {
        attrs.insert("stroke".into(), json!(scrivi_colore(r, Some(&s.paint))?));
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
    Ok(())
}

/// I sottotracciati di un tracciato composto fatto solo di tracciati semplici
/// (non forme vive, non tracciati di ritaglio o guide), nell'ordine dei
/// figli, e la sua regola di riempimento: ciò che un `<path>` dice con `d` e
/// `fill-rule`. `None` per ogni altro oggetto.
fn tracciato_composto(n: &Node) -> Option<(PathData, FillRule)> {
    let NodeKind::Compound { children, rule } = &n.kind else {
        return None;
    };
    let mut tutto = PathData::default();
    for c in children {
        let NodeKind::Path {
            path,
            live: None,
            clipping: false,
            guide: false,
            ..
        } = &c.kind
        else {
            return None;
        };
        tutto.subpaths.extend(path.subpaths.iter().cloned());
    }
    Some((tutto, *rule))
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

/// Gli attributi della geometria di una forma semplice che, deformata,
/// diventa un tracciato: rettangolo, cerchio, ellisse, poligono e
/// polilinea, come le scrive Fub (il ruolo è il tag: niente stelle o poligoni
/// di Fub). `None` per tutto il resto, anche per `line`, che non si riempie.
fn geometria_della_forma(e: &Elemento) -> Option<&'static [&'static str]> {
    use fub_scene::Role;
    Some(match (e.tag, e.ruolo) {
        ("rect", Role::Rect) => &["x", "y", "width", "height", "rx", "ry"],
        ("circle", Role::Circle) => &["cx", "cy", "r"],
        ("ellipse", Role::Ellipse) => &["cx", "cy", "rx", "ry"],
        ("polygon", Role::Polygon) | ("polyline", Role::Polyline) => &["points"],
        _ => return None,
    })
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

    /// Un gruppo di due foglie vuote.
    fn gruppo(id: u64, figli: Vec<Arc<Node>>) -> Arc<Node> {
        Arc::new(Node::group(NodeId(id), figli))
    }

    fn foglia(id: u64) -> Arc<Node> {
        Arc::new(Node::group(NodeId(id), Vec::new()))
    }

    #[test]
    fn uguali_come_il_confronto_intero() {
        let (x, y) = (foglia(2), foglia(3));
        let b = gruppo(1, vec![x.clone(), y.clone()]);
        // Gli stessi figli condivisi, il gruppo rifatto: uguali.
        let a = gruppo(1, vec![x.clone(), y.clone()]);
        assert!(uguali(&b, &a) && *b == *a);
        // Un figlio uguale ma non condiviso: uguali lo stesso.
        let a = gruppo(1, vec![x.clone(), foglia(3)]);
        assert!(uguali(&b, &a) && *b == *a);
        // Un figlio diverso, uno in più, una proprietà del gruppo diversa.
        let a = gruppo(1, vec![x.clone(), foglia(4)]);
        assert!(!uguali(&b, &a) && *b != *a);
        let a = gruppo(1, vec![x.clone(), y.clone(), foglia(4)]);
        assert!(!uguali(&b, &a) && *b != *a);
        let mut n = Node::group(NodeId(1), vec![x.clone(), y.clone()]);
        n.opacity = 0.5;
        let a = Arc::new(n);
        assert!(!uguali(&b, &a) && *b != *a);
    }

    #[test]
    fn proprieta_senza_i_figli() {
        let b = gruppo(1, vec![foglia(2)]);
        // Figli diversi, stesse proprietà.
        assert!(proprieta_uguali(&b, &gruppo(1, vec![foglia(3), foglia(4)])));
        let mut n = Node::group(NodeId(1), vec![foglia(2)]);
        n.opacity = 0.5;
        assert!(!proprieta_uguali(&b, &n));
        // Il nodo di partenza resta com'era.
        assert_eq!(b.children().map(Vec::len), Some(1));
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
