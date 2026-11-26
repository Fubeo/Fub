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
//!   su un composto sono un `set` del `d`. La regola di riempimento è
//!   `fill-rule`, scritta solo dove cambia quella ereditata dal genitore.
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
use testo::{da_riscrivere, riscrittura, sul_tracciato_cambiato, testo_cambiato, TestoRiscritto};

#[path = "differenza_confronto.rs"]
mod confronto;
#[path = "differenza_livelli.rs"]
mod livelli;
#[path = "differenza_ordine.rs"]
mod ordine;
#[path = "differenza_scrittura.rs"]
mod scrittura;
pub use scrittura::*;
#[path = "differenza_uguaglianze.rs"]
mod uguaglianze;
pub(crate) use testo::{figlio_sul_tracciato, peso_e_corsivo};
pub(crate) use uguaglianze::*;

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
        tracciati_dei_testi: Vec::new(),
        ricette: ricetta::Scritte::default(),
        liberati: HashSet::new(),
        assorbiti: HashSet::new(),
        riferimenti: Riferimenti::default(),
        sfumature: Vec::new(),
        simboli: Default::default(),
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
    // I simboli prima delle istanze: un'istanza nuova vuole l'id del suo.
    lavoro.simboli = {
        let mappa = &copia.mappa;
        let dati = &mut lavoro.dati;
        let mut stampo = None;
        crate::simboli::operazioni(
            &copia.simboli,
            &copia.documento,
            dopo,
            &mut stampo,
            &mut |specie| {
                let id = id::nuovo(specie, &|id| mappa.id_preso(id) || dati.contains(id))
                    .ok_or_else(|| "nessun id nuovo libero".to_string())?;
                dati.insert(id.clone());
                Ok(id)
            },
        )
        .map_err(no)?
    };
    lavoro.composti(&prima, &poi);
    lavoro.ritagli(&prima, &poi)?;
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
    let mut tavole_nuove = HashMap::new();
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
            &mut tavole_nuove,
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
        simboli,
        tracciati_dei_testi,
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
    // Le guide dopo le tavole: possono nominare una tavola nuova.
    ops.extend(operazione_delle_guide(copia, dopo, &tavole_nuove, &ids)?);
    ops.extend(tracciati_dei_testi);
    // I campioni nuovi o cambiati prima di chi li usa, quelli tolti per
    // ultimi, quando nessuno li usa più. Sono risorse, non oggetti del
    // disegno: il controllo delle parti non mappate non li guarda.
    // Le sfumature private nuove, dopo i campioni (che possono aver fatto la
    // `fub-defs`) e prima di chi le usa; le vecchie le toglie la scena con
    // il loro ultimo riferimento.
    let sfumature = ops_delle_sfumature(copia, &dei_campioni.davanti, sfumature);
    // I simboli nuovi e cambiati dopo le risorse (che possono aver fatto la
    // `fub-defs`) e prima delle istanze; quelli tolti per ultimi, quando
    // nessuna istanza li usa più.
    let dei_simboli = ops_dei_simboli(copia, &dei_campioni.davanti, &sfumature, &simboli);
    let mut ops =
        if dei_campioni.davanti.is_empty() && sfumature.is_empty() && dei_simboli.is_empty() {
            ops
        } else {
            let mut tutte = dei_campioni.davanti;
            tutte.extend(sfumature);
            tutte.extend(dei_simboli);
            tutte.extend(ops);
            tutte
        };
    ops.extend(dei_campioni.in_fondo);
    ops.extend(simboli.tolti);
    if ops.len() > MAX_DRAWING_OPS {
        return Err(Rifiuto::TroppoGrande);
    }
    Ok(Differenza { ops, ids })
}

/// Il `set` di `fub:guides` sulla radice, se le guide del motore sono
/// cambiate (`crate::guide`): una tavola si nomina con l'id del file (o con
/// quello nuovo, se è nata ora), un livello con l'id del suo elemento (o con
/// quello nuovo).
fn operazione_delle_guide(
    copia: &Copia,
    dopo: &Document,
    tavole_nuove: &HashMap<u32, String>,
    ids: &HashMap<NodeId, String>,
) -> Result<Option<Value>, Rifiuto> {
    let tavola = |t: u32| {
        copia
            .tavole
            .del_file
            .iter()
            .find(|d| d.motore == t)
            .map(|d| d.id.clone())
            .or_else(|| tavole_nuove.get(&t).cloned())
    };
    let livello = |n: NodeId| {
        ids.get(&n).cloned().or_else(|| {
            let e = copia.mappa.elemento(copia.mappa.del_nodo(n)?)?;
            e.id_del_file().map(str::to_string)
        })
    };
    crate::guide::operazione(
        &copia.guide,
        &copia.documento,
        dopo,
        copia.radice,
        &tavola,
        &livello,
    )
    .map_err(|e| match e {
        crate::guide::NonSiScrive::Ferme(motivo) => no(motivo.motivo()),
        crate::guide::NonSiScrive::Bloccata => {
            no("una guida bloccata non si sposta e non si toglie da sola")
        }
    })
}

/// Gli attributi del `use` di un'istanza nuova (o riscritta) `nodo`, con
/// la matrice `transform` e il simbolo del file `rid`. Ciò che un'istanza
/// del formato non porta si rifiuta.
fn attributi_dell_istanza(
    nodo: &Node,
    id: &str,
    transform: Affine,
    rid: &str,
) -> Result<Map<String, Value>, Rifiuto> {
    if !transform.is_finite() {
        return Err(no("l'istanza ha una transform che non si scrive"));
    }
    if !nodo.appearance.items.is_empty() || !nodo.extras().symbol_overrides.is_empty() {
        return Err(no(
            "un'istanza con un aspetto suo o con parti cambiate non si scrive nel file",
        ));
    }
    if nodo.extras().mask.is_some() {
        return Err(no(
            "un'istanza con una maschera non si scrive ancora nel file",
        ));
    }
    if nodo.blend != vectorcraft_color::BlendMode::Normal {
        return Err(no(
            "un'istanza con una fusione non si scrive ancora nel file",
        ));
    }
    if nodo.locked {
        return Err(no("un'istanza bloccata non si scrive ancora nel file"));
    }
    let mut attrs = Map::new();
    attrs.insert("id".into(), json!(id));
    if !vicina_all_identita(transform) {
        attrs.insert("transform".into(), json!(scrivi_matrice(transform)));
    }
    attrs.insert("href".into(), json!(format!("#{rid}")));
    if nodo.opacity < 1.0 {
        attrs.insert("opacity".into(), json!(numero(f64::from(nodo.opacity), 3)));
    }
    if !nodo.visible {
        attrs.insert("display".into(), json!("none"));
    }
    Ok(attrs)
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

/// Gli `add` dei simboli nuovi nella `fub-defs` (quella del file, quella
/// che le risorse del gesto fanno, o una nuova vuota in testa alla radice),
/// poi i cambi di quelli che c'erano.
fn ops_dei_simboli(
    copia: &Copia,
    campioni: &[Value],
    sfumature: &[Value],
    simboli: &crate::simboli::ScritturaDeiSimboli,
) -> Vec<Value> {
    let mut fuori = Vec::new();
    if !simboli.nuovi.is_empty() {
        let fatta = campioni.iter().chain(sfumature).any(|op| {
            op["elem"]["tag"] == "defs" && op["elem"]["attrs"]["id"] == campioni::DEFS_DI_FUB
        });
        if copia.campioni.defs.is_none() && !fatta {
            fuori.push(json!({
                "op": "add", "parent": "#root", "pos": { "first": true },
                "elem": { "tag": "defs", "attrs": { "id": campioni::DEFS_DI_FUB } },
            }));
        }
        let defs = copia
            .campioni
            .defs
            .clone()
            .unwrap_or_else(|| campioni::DEFS_DI_FUB.to_string());
        for raw in &simboli.nuovi {
            fuori.push(json!({ "op": "add", "parent": defs, "pos": { "last": true }, "raw": raw }));
        }
    }
    fuori.extend(simboli.cambi.iter().cloned());
    fuori
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
    /// I `set` del `d` dei tracciati privati dei testi su tracciato (risorse in `<defs>`): dopo il
    /// controllo delle parti non mappate, che non guarda le risorse.
    tracciati_dei_testi: Vec<Value>,
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
    /// I simboli del gesto (`crate::simboli`): gli id del file dei simboli
    /// del motore, per le istanze nuove.
    simboli: crate::simboli::ScritturaDeiSimboli,
}

impl Lavoro<'_> {}

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
