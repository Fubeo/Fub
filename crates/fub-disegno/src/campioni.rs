//! I campioni del documento fra il file e il motore
//! (`docs/reference/scene-format-resources.md` §2, §7, §9;
//! `docs/product/drawing-colors.md`).
//!
//! Nel file un campione è una `linearGradient` con `fub:role="swatch"`, un
//! nome in `fub:name` e un solo `stop`, nella `defs` della radice; chi lo usa
//! scrive `url(#id) #rrggbb`, il riferimento e il colore di ripiego. Nel
//! motore è uno `Swatch` di `Document::swatches`, e chi lo usa ha un
//! `Paint::Solid` legato per nome.
//!
//! - **All'apertura** ([`nel_motore`]) i campioni del motore di serie se ne
//!   vanno (resta «Nessuno»): restano quelli del file, tutti **globali**,
//!   perché nel file un campione si usa sempre per riferimento. Il
//!   riempimento e il contorno scritti `url(#campione)` si legano al loro
//!   campione, nelle forme e nei pezzi dei testi.
//! - **Dopo un comando** ([`operazioni`]) la differenza confronta i campioni
//!   di prima e di dopo per nome: un campione nuovo è un `add` nella `defs`
//!   di Fub (che nasce se manca), uno tolto un `remove` in fondo al passo,
//!   dopo che chi lo usava ha preso il suo colore; un colore cambiato è un
//!   `set` del suo `stop` (`part: [0]`), un nome cambiato un `set` di
//!   `fub:name`. Chi usa un campione lo scrive col riferimento
//!   ([`Riferimenti`]).
//! - **I gruppi di colori** stanno in un attributo di ogni campione del
//!   gruppo, `fub:group` col nome del gruppo (§2): niente elemento nuovo, così
//!   un'altra versione di Fub, o un altro programma, legge i campioni e
//!   ignora il gruppo. Nel motore un gruppo è uno `SwatchGroup` di
//!   `Document::swatch_groups`, nell'ordine del suo primo campione nel file.
//!   Un `fub:group` che non si legge come gruppo (vuoto, col nome di un
//!   campione, di un motivo o di un campione riservato), o i cui membri non
//!   stanno uno dopo l'altro nella stessa `defs`, si ignora e resta com'è: il
//!   campione è senza gruppo. Nel file si scrivono prima i campioni
//!   senza gruppo, poi i membri di ogni gruppo, gruppo dopo gruppo; un
//!   gruppo vuoto non lascia niente, e il comando che lo crea vuoto si rifiuta.
//!
//! Il formato non ha campioni non globali, tinte, sfumature o motivi del
//! motore come campioni: un comando che li fa si rifiuta, e il file resta
//! com'è.

use std::collections::{HashMap, HashSet};

use fub_scene::{Item, Role};
use serde_json::{json, Value};
use vectorcraft_doc::color::{Color, Paint, Swatch, SwatchGroup};
use vectorcraft_doc::{Document, NodeKind};

use crate::apertura::{attributi, valore};
use crate::mappa::Mappa;

/// Il nome del campione «Nessuno» del motore, che resta: non è del file.
const NESSUNO: &str = "[None]";

/// L'attributo del gruppo di colori di un campione (formato della scena, risorse, §2).
pub(crate) const ATTRIBUTO_GRUPPO: &str = "fub:group";

/// Il perché di un gruppo di colori senza campioni: il file non lo scrive.
pub(crate) const TESTO_GRUPPO_VUOTO: &str =
    "Un gruppo di colori vuoto non si salva: scegli almeno un campione.";

/// L'id della `defs` che FubDraw crea per le sue risorse.
pub(crate) const DEFS_DI_FUB: &str = "fub-defs";

/// Un campione del file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Campione {
    /// L'id della `linearGradient`.
    pub id: String,
    /// `fub:name`, com'è scritto.
    pub nome: String,
    /// Il colore del suo `stop`, `#rrggbb` minuscolo.
    pub colore: String,
    /// L'id della `defs` che lo contiene, se ne ha una: l'ordine si scrive
    /// solo dentro la `defs` dove nascono i campioni nuovi.
    pub genitore: Option<String>,
    /// Il gruppo di colori, da `fub:group` com'è scritto, se si legge come
    /// gruppo ([`gruppo_valido`]); `None` per un campione senza gruppo, o
    /// con un `fub:group` che si ignora.
    pub gruppo: Option<String>,
}

/// I campioni del file e dove ne nascono di nuovi.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CampioniDelFile {
    /// In ordine di documento.
    pub elenco: Vec<Campione>,
    /// L'id della `defs` della radice dove va un campione nuovo: `fub-defs`,
    /// o la prima con un id; `None` se non c'è, e allora nasce `fub-defs`.
    pub defs: Option<String>,
    /// I nomi dei motivi del documento: un campione nuovo non li prende.
    pub motivi: Vec<String>,
}

/// I campioni che un elemento usa: l'id del campione del riempimento e
/// quello del contorno.
#[derive(Clone, Debug, Default)]
pub(crate) struct Usi {
    pub riempimento: Option<String>,
    pub contorno: Option<String>,
}

/// I campioni della scena e, per percorso, gli elementi che li usano.
pub(crate) fn leggi(testo: &str, items: &[Item]) -> (CampioniDelFile, HashMap<Vec<usize>, Usi>) {
    let mut campioni = CampioniDelFile::default();
    let mut prima_defs: Option<String> = None;
    // Le `defs` con un id, per percorso: il genitore di un campione è quello del suo percorso.
    let mut defs_per_percorso: HashMap<Vec<usize>, String> = HashMap::new();
    for item in items {
        let Item::Element(e) = item else { continue };
        if e.role == Role::Defs {
            if let Some(id) = &e.id {
                defs_per_percorso.insert(e.path.clone(), id.clone());
            }
        }
        if e.role == Role::Defs && e.path.len() == 1 {
            if let Some(id) = &e.id {
                if id == DEFS_DI_FUB {
                    campioni.defs = Some(id.clone());
                } else if prima_defs.is_none() {
                    prima_defs = Some(id.clone());
                }
            }
        }
        if e.role == Role::Resource {
            if let (Some(id), Some(s)) = (&e.id, &e.swatch) {
                let genitore = e
                    .path
                    .split_last()
                    .and_then(|(_, padre)| defs_per_percorso.get(padre))
                    .cloned();
                let gruppo = attributi(testo, e.span.bytes[0])
                    .and_then(|(_, attr)| valore(&attr, ATTRIBUTO_GRUPPO).map(str::to_owned));
                campioni.elenco.push(Campione {
                    id: id.clone(),
                    nome: s.name.clone(),
                    colore: s.color.clone(),
                    genitore,
                    gruppo,
                });
            }
            if let Some(m) = &e.motif {
                campioni.motivi.push(m.name.clone());
            }
        }
    }
    if campioni.defs.is_none() {
        campioni.defs = prima_defs;
    }
    // Un `fub:group` si legge come gruppo solo quando il nome è libero: non è vuoto, né il nome di
    // un campione, di un motivo o di un campione riservato del motore.
    let nomi: HashSet<String> = campioni.elenco.iter().map(|c| c.nome.clone()).collect();
    let motivi = campioni.motivi.clone();
    for c in &mut campioni.elenco {
        if !c.gruppo.as_deref().is_some_and(|g| {
            gruppo_valido(g, &|n| nomi.contains(n) || motivi.iter().any(|m| m == n))
        }) {
            c.gruppo = None;
        }
    }
    // I membri di un gruppo stanno uno dopo l'altro nella stessa `defs`, come Fub li scrive: un
    // gruppo sparso (un altro programma, un file scritto a mano) si ignora tutto, così un comando non
    // sposta i campioni di chi l'ha scritto.
    let sparsi: HashSet<String> = campioni
        .elenco
        .iter()
        .filter_map(|c| c.gruppo.clone())
        .filter(|g| {
            let posti: Vec<usize> = campioni
                .elenco
                .iter()
                .enumerate()
                .filter(|(_, c)| c.gruppo.as_deref() == Some(g.as_str()))
                .map(|(i, _)| i)
                .collect();
            let primo = &campioni.elenco[posti[0]];
            posti.windows(2).any(|w| w[1] != w[0] + 1)
                || posti
                    .iter()
                    .any(|i| campioni.elenco[*i].genitore != primo.genitore)
        })
        .collect();
    for c in &mut campioni.elenco {
        if c.gruppo.as_ref().is_some_and(|g| sparsi.contains(g)) {
            c.gruppo = None;
        }
    }
    let mut usi = HashMap::new();
    if campioni.elenco.is_empty() {
        return (campioni, usi);
    }
    let del_campione = |v: Option<&str>| -> Option<String> {
        let id = riferimento(v?)?;
        campioni
            .elenco
            .iter()
            .any(|c| c.id == id)
            .then(|| id.to_string())
    };
    for item in items {
        let Item::Element(e) = item else { continue };
        if matches!(e.role, Role::Defs | Role::Resource) {
            continue;
        }
        let Some((_, attr)) = attributi(testo, e.span.bytes[0]) else {
            continue;
        };
        let u = Usi {
            riempimento: del_campione(valore(&attr, "fill")),
            contorno: del_campione(valore(&attr, "stroke")),
        };
        if u.riempimento.is_some() || u.contorno.is_some() {
            usi.insert(e.path.clone(), u);
        }
    }
    (campioni, usi)
}

/// Vero se `gruppo` è il nome di un gruppo di colori che il file può avere: non vuoto, né un nome
/// riservato del motore («[None]», «[Registration]»), né un nome che `preso` dice già di un campione
/// o di un motivo (nel motore campioni e gruppi hanno i nomi in comune).
pub(crate) fn gruppo_valido(gruppo: &str, preso: &dyn Fn(&str) -> bool) -> bool {
    !gruppo.trim().is_empty()
        && gruppo != NESSUNO
        && gruppo != vectorcraft_doc::color::swatch::REGISTRATION
        && !preso(gruppo)
}

/// L'id di `url(#id)` in testa a un valore di `fill` o `stroke`.
fn riferimento(v: &str) -> Option<&str> {
    let resto = v.trim_start().strip_prefix("url(")?.trim_start();
    let resto = resto.strip_prefix('#')?;
    let fine = resto.find(|c: char| c == ')' || c.is_whitespace())?;
    Some(&resto[..fine])
}

/// I campioni del file nel motore, globali, e i colori di chi li usa legati
/// a loro. I campioni di serie del motore se ne vanno: resta «Nessuno».
pub(crate) fn nel_motore(
    campioni: &CampioniDelFile,
    usi: &HashMap<Vec<usize>, Usi>,
    mappa: &Mappa,
    documento: &mut Document,
) {
    let nessuno = documento
        .swatches
        .iter()
        .find(|s| s.name == NESSUNO)
        .cloned();
    let mut elenco: Vec<Swatch> = nessuno.into_iter().collect();
    let mut gruppi: Vec<SwatchGroup> = Vec::new();
    let mut visti: HashSet<String> = HashSet::new();
    for c in &campioni.elenco {
        let Some(colore) = Color::from_hex(&c.colore) else {
            continue;
        };
        if !visti.insert(c.nome.clone()) || c.nome == NESSUNO {
            continue;
        }
        let campione = Swatch {
            name: c.nome.clone(),
            paint: Paint::solid(colore),
            global: true,
            spot: false,
        };
        // Il gruppo prende il posto del suo primo campione nel file, anche coi membri sparsi.
        match &c.gruppo {
            None => elenco.push(campione),
            Some(nome) => match gruppi.iter_mut().find(|g| &g.name == nome) {
                Some(g) => g.swatches.push(campione),
                None => gruppi.push(SwatchGroup {
                    name: nome.clone(),
                    swatches: vec![campione],
                }),
            },
        }
    }
    *documento.swatches = elenco;
    *documento.swatch_groups = gruppi;
    if usi.is_empty() {
        return;
    }
    let nome_di = |id: &Option<String>| -> Option<String> {
        let id = id.as_deref()?;
        campioni
            .elenco
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.nome.clone())
    };
    for e in mappa.elementi() {
        let (Some(nodo), Some(u)) = (e.nodo, usi.get(&e.percorso)) else {
            continue;
        };
        let (riempimento, contorno) = (nome_di(&u.riempimento), nome_di(&u.contorno));
        let Some(n) = documento.node_mut(nodo) else {
            continue;
        };
        for it in n.appearance.items.iter_mut() {
            let (paint, nome) = match it {
                vectorcraft_doc::AppearanceItem::Fill(l) => (&mut l.paint, &riempimento),
                vectorcraft_doc::AppearanceItem::Stroke(l) => (&mut l.paint, &contorno),
            };
            lega(paint, nome);
        }
        if let NodeKind::Text(t) = &mut n.kind {
            for r in t.runs.iter_mut() {
                lega(&mut r.style.fill, &riempimento);
                lega(&mut r.style.stroke, &contorno);
            }
        }
    }
}

/// Lega un colore pieno al campione `nome`.
fn lega(paint: &mut Paint, nome: &Option<String>) {
    if let (Paint::Solid { swatch, tint, .. }, Some(nome)) = (paint, nome) {
        *swatch = Some(nome.clone());
        *tint = 1.0;
    }
}

/// Come si scrive chi usa un campione: l'id del campione per nome, prima e
/// dopo il comando.
#[derive(Clone, Debug, Default)]
pub(crate) struct Riferimenti {
    prima: HashMap<String, String>,
    dopo: HashMap<String, String>,
}

impl Riferimenti {
    /// I riferimenti dei campioni del file, senza comando.
    pub(crate) fn del_file(campioni: &CampioniDelFile) -> Riferimenti {
        let prima: HashMap<String, String> = campioni
            .elenco
            .iter()
            .map(|c| (c.nome.clone(), c.id.clone()))
            .collect();
        Riferimenti {
            dopo: prima.clone(),
            prima,
        }
    }

    /// Il valore di `fill` o `stroke` di un colore di dopo il comando:
    /// `url(#id) #rrggbb` se è legato a un campione del file, se no il
    /// colore; `none` per nessun colore. Una sfumatura o un motivo non si
    /// scrivono così: `None`.
    pub(crate) fn scrivi(&self, p: Option<&Paint>) -> Option<String> {
        match p {
            None | Some(Paint::None) => Some("none".into()),
            Some(Paint::Solid { color, swatch, .. }) => {
                Some(match swatch.as_deref().and_then(|n| self.dopo.get(n)) {
                    Some(id) => format!("url(#{id}) {}", color.to_hex()),
                    None => color.to_hex(),
                })
            }
            Some(_) => None,
        }
    }

    /// Vero se due colori, uno di prima e uno di dopo, si scrivono uguali:
    /// lo stesso colore e lo stesso campione del file, anche col nome
    /// cambiato.
    pub(crate) fn uguali(&self, prima: Option<&Paint>, dopo: Option<&Paint>) -> bool {
        match (prima, dopo) {
            (
                Some(Paint::Solid {
                    color: cp,
                    swatch: sp,
                    ..
                }),
                Some(Paint::Solid {
                    color: cd,
                    swatch: sd,
                    ..
                }),
            ) => {
                cp.to_hex() == cd.to_hex()
                    && sp.as_deref().and_then(|n| self.prima.get(n))
                        == sd.as_deref().and_then(|n| self.dopo.get(n))
            }
            (a, b) => a == b,
        }
    }

    /// Vero se il colore di prima e quello di dopo sono legati allo stesso
    /// campione del file: solo il colore del campione è cambiato.
    pub(crate) fn stesso_campione(&self, prima: Option<&Paint>, dopo: Option<&Paint>) -> bool {
        match (prima, dopo) {
            (Some(Paint::Solid { swatch: sp, .. }), Some(Paint::Solid { swatch: sd, .. })) => {
                let (a, b) = (
                    sp.as_deref().and_then(|n| self.prima.get(n)),
                    sd.as_deref().and_then(|n| self.dopo.get(n)),
                );
                a.is_some() && a == b
            }
            _ => false,
        }
    }
}

/// Le operazioni dei campioni di un comando.
#[derive(Debug, Default)]
pub(crate) struct OpsDeiCampioni {
    /// Gli `add` e i `set` dei campioni: in testa al passo, prima di chi li
    /// usa.
    pub davanti: Vec<Value>,
    /// I `remove` dei campioni tolti: in fondo, dopo che chi li usava ha
    /// preso il suo colore.
    pub in_fondo: Vec<Value>,
    /// Come si scrive chi li usa.
    pub riferimenti: Riferimenti,
}

/// Perché i campioni di dopo non si scrivono nel file.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum NonSiScrive {
    /// Un campione che il formato non ha: una sfumatura, un motivo, una
    /// tinta, un colore non globale o spot, o un gruppo col nome di un motivo o che il file non scrive.
    Forma(String),
    /// Un nome che è già di un motivo del documento.
    NomeDiUnMotivo(String),
}

/// Vero se il gruppo non ha campioni che il file scrive (nessuno, o solo i riservati).
pub(crate) fn gruppo_vuoto(gruppo: &SwatchGroup) -> bool {
    gruppo.swatches.iter().all(Swatch::is_reserved)
}

/// Un campione del motore di dopo il comando, come il file lo scrive.
#[derive(Debug)]
struct DiDopo<'a> {
    nome: &'a str,
    colore: String,
    gruppo: Option<&'a str>,
}

/// I campioni del motore di dopo il comando che il file deve avere, tutti
/// tranne «Nessuno» e la Registrazione: prima quelli senza gruppo, poi i
/// membri di ogni gruppo, gruppo dopo gruppo. Un gruppo vuoto non lascia
/// niente; uno col nome di un motivo, o con un nome che il file non scrive, non si scrive.
fn del_documento<'a>(
    dopo: &'a Document,
    motivi: &[String],
) -> Result<Vec<DiDopo<'a>>, NonSiScrive> {
    let mut fuori = Vec::new();
    let senza = dopo.swatches.iter().map(|s| (s, None));
    let nei_gruppi = dopo
        .swatch_groups
        .iter()
        .flat_map(|g| g.swatches.iter().map(move |s| (s, Some(g.name.as_str()))));
    for g in dopo.swatch_groups.iter() {
        // Un gruppo senza campioni non ha niente da scrivere: sparisce (l'ultimo membro eliminato o
        // spostato fuori). Il comando che lo crea vuoto si rifiuta prima, nella famiglia.
        if gruppo_vuoto(g) {
            continue;
        }
        if motivi.contains(&g.name) {
            return Err(NonSiScrive::NomeDiUnMotivo(g.name.clone()));
        }
        if !gruppo_valido(&g.name, &|n| dopo.swatch(n).is_some()) {
            return Err(NonSiScrive::Forma(format!(
                "il gruppo di colori «{}» non ha un nome che il file scrive",
                g.name
            )));
        }
    }
    for (s, gruppo) in senza.chain(nei_gruppi) {
        if s.is_reserved() {
            continue;
        }
        match &s.paint {
            Paint::Solid {
                color,
                swatch: None,
                ..
            } if s.global && !s.spot => fuori.push(DiDopo {
                nome: s.name.as_str(),
                colore: color.to_hex(),
                gruppo,
            }),
            _ => {
                return Err(NonSiScrive::Forma(format!(
                    "il campione «{}» non è un colore globale: il formato non lo scrive",
                    s.name
                )))
            }
        }
    }
    Ok(fuori)
}

/// I campioni che un comando lascia nel motore, portati nel formato del disegno (K6 T14): nel file un
/// campione si usa sempre per riferimento, quindi diventa **globale** (il motore fa non globali i
/// colori nuovi di un gruppo e quelli delle librerie). Con `piatto` (`swatch.library.add`, decisione
/// del coordinatore) i gruppi si sciolgono: i membri vanno dopo i campioni senza gruppo, nell'ordine
/// dei gruppi. `None` se il documento è già nel formato.
pub(crate) fn porta_nel_formato(dopo: &Document, piatto: bool) -> Option<Document> {
    let serve = (piatto && !dopo.swatch_groups.is_empty())
        || dopo.swatches_iter().any(|s| !s.is_reserved() && !s.global);
    if !serve {
        return None;
    }
    let mut nuovo = dopo.clone();
    if piatto {
        let gruppi = std::mem::take(&mut *nuovo.swatch_groups);
        for gruppo in gruppi {
            nuovo.swatches.extend(gruppo.swatches);
        }
    }
    for swatch in nuovo.swatches_iter_mut().filter(|s| !s.is_reserved()) {
        swatch.global = true;
    }
    Some(nuovo)
}

/// Le operazioni dei campioni fra il file e il documento di dopo. `id_nuovo`
/// dà l'id di una risorsa nuova.
pub(crate) fn operazioni(
    campioni: &CampioniDelFile,
    dopo: &Document,
    id_nuovo: &mut dyn FnMut() -> Option<String>,
) -> Result<OpsDeiCampioni, NonSiScrive> {
    let mut fuori = OpsDeiCampioni {
        riferimenti: Riferimenti::del_file(campioni),
        ..OpsDeiCampioni::default()
    };
    let poi = del_documento(dopo, &campioni.motivi)?;
    let prima = &campioni.elenco;
    let uguali_di_prima = prima.len() == poi.len()
        && prima.iter().zip(&poi).all(|(a, d)| {
            a.nome == d.nome && a.colore == d.colore && a.gruppo.as_deref() == d.gruppo
        });
    if uguali_di_prima {
        return Ok(fuori);
    }
    // Per nome; quelli rimasti senza compagno, uno a uno nell'ordine, se
    // sono tanti quanti: un nome cambiato.
    let mut compagno: Vec<Option<usize>> = vec![None; poi.len()];
    let mut preso = vec![false; prima.len()];
    for (j, d) in poi.iter().enumerate() {
        if let Some(i) = prima.iter().position(|c| c.nome == d.nome) {
            if !preso[i] {
                preso[i] = true;
                compagno[j] = Some(i);
            }
        }
    }
    let soli_prima: Vec<usize> = (0..prima.len()).filter(|i| !preso[*i]).collect();
    let soli_dopo: Vec<usize> = (0..poi.len()).filter(|j| compagno[*j].is_none()).collect();
    if soli_prima.len() == soli_dopo.len() {
        for (i, j) in soli_prima.iter().zip(&soli_dopo) {
            compagno[*j] = Some(*i);
            preso[*i] = true;
        }
    }
    // Gli id di dopo, in ordine di documento: quello del file, o uno nuovo.
    let mut ids: Vec<String> = Vec::with_capacity(poi.len());
    let mut elementi: Vec<Value> = Vec::with_capacity(poi.len());
    for (j, d) in poi.iter().enumerate() {
        let (nome, colore) = (&d.nome, &d.colore);
        match compagno[j] {
            Some(i) => {
                let c = &prima[i];
                if c.nome != *nome {
                    if campioni.motivi.iter().any(|m| m == nome) {
                        return Err(NonSiScrive::NomeDiUnMotivo((*nome).to_string()));
                    }
                    fuori.davanti.push(json!({
                        "op": "set", "id": c.id, "attrs": { "fub:name": nome },
                    }));
                }
                if c.colore != *colore {
                    fuori.davanti.push(json!({
                        "op": "set", "id": c.id, "part": [0],
                        "attrs": { "stop-color": colore },
                    }));
                }
                // Il gruppo: un `fub:group` che si ignorava resta com'è finché il campione resta
                // senza gruppo; entrare in un gruppo lo scrive, uscirne lo toglie.
                if c.gruppo.as_deref() != d.gruppo {
                    fuori.davanti.push(json!({
                        "op": "set", "id": c.id, "attrs": { ATTRIBUTO_GRUPPO: d.gruppo },
                    }));
                }
                fuori.riferimenti.dopo.remove(&c.nome);
                fuori
                    .riferimenti
                    .dopo
                    .insert((*nome).to_string(), c.id.clone());
                ids.push(c.id.clone());
                elementi.push(Value::Null);
            }
            None => {
                if campioni.motivi.iter().any(|m| m == nome) {
                    return Err(NonSiScrive::NomeDiUnMotivo((*nome).to_string()));
                }
                let Some(id) = id_nuovo() else {
                    return Err(NonSiScrive::Forma("nessun id nuovo libero".into()));
                };
                fuori
                    .riferimenti
                    .dopo
                    .insert((*nome).to_string(), id.clone());
                let mut attrs = json!({
                    "id": id, "fub:role": "swatch", "fub:name": nome,
                    "gradientUnits": "userSpaceOnUse",
                });
                if let Some(gruppo) = d.gruppo {
                    attrs[ATTRIBUTO_GRUPPO] = json!(gruppo);
                }
                elementi.push(json!({
                    "tag": "linearGradient",
                    "attrs": attrs,
                    "children": [ { "tag": "stop", "attrs": { "stop-color": colore } } ],
                }));
                ids.push(id);
            }
        }
    }
    // Un nome di prima può tornare a un altro campione (due nomi scambiati):
    // le mappe tengono l'ultimo, e i rinominati sono già scritti sopra.
    for (i, c) in prima.iter().enumerate() {
        if !preso[i] {
            fuori.riferimenti.dopo.remove(&c.nome);
            fuori
                .in_fondo
                .push(json!({ "op": "remove", "target": c.id }));
        }
    }
    // L'ordine. Si scrive solo dove i campioni del file stanno tutti nella defs dove
    // nascono i nuovi. Si va nell'ordine di dopo: un campione nuovo o spostato va subito
    // dopo il suo predecessore, e quelli nella sequenza crescente restano fermi, come
    // fanno gli spostamenti dei nodi.
    let defs = campioni.defs.clone();
    let scrivibile = prima
        .iter()
        .all(|c| c.genitore.is_some() && c.genitore == defs);
    let fermi = crate::differenza::sottosequenza_crescente(&compagno);
    let mut in_ordine: Vec<Value> = Vec::new();
    let mut in_defs_nuova: Vec<Value> = Vec::new();
    for j in 0..poi.len() {
        // In coda, da qui in poi tutti i campioni sono nuovi: si aggiungono in fondo, nell'ordine.
        let in_coda = compagno[j..].iter().all(|c| c.is_none());
        let pos = if in_coda {
            json!({ "last": true })
        } else if j == 0 {
            json!({ "first": true })
        } else {
            json!({ "after": ids[j - 1] })
        };
        let dopo_un_predecessore = !in_coda && j > 0;
        match compagno[j] {
            Some(_) if fermi.contains(&j) => {}
            Some(i) => {
                let Some(defs) = defs.as_ref().filter(|_| scrivibile) else {
                    return Err(ordine_non_scrivibile());
                };
                in_ordine.push(json!({
                    "op": "move", "target": prima[i].id.clone(), "parent": defs, "pos": pos,
                }));
            }
            None => match &defs {
                Some(defs) => {
                    if dopo_un_predecessore && !scrivibile {
                        return Err(ordine_non_scrivibile());
                    }
                    in_ordine.push(json!({
                        "op": "add", "parent": defs, "pos": pos, "elem": elementi[j].clone(),
                    }));
                }
                None => in_defs_nuova.push(elementi[j].clone()),
            },
        }
    }
    fuori.davanti.extend(in_ordine);
    if !in_defs_nuova.is_empty() {
        fuori.davanti.push(json!({
            "op": "add", "parent": "#root", "pos": { "first": true },
            "elem": { "tag": "defs", "attrs": { "id": DEFS_DI_FUB }, "children": in_defs_nuova },
        }));
    }
    Ok(fuori)
}

/// Il riordino dei campioni che il file non può scrivere: non stanno tutti nella defs dove nascono i nuovi.
fn ordine_non_scrivibile() -> NonSiScrive {
    NonSiScrive::Forma(
        "i campioni non stanno tutti nella stessa defs: il loro ordine non si scrive".into(),
    )
}

/// L'elemento `i` della mappa, o un suo antenato, è bloccato.
fn bloccato_con_antenati(mappa: &crate::mappa::Mappa, mut i: usize) -> bool {
    while let Some(e) = mappa.elemento(i) {
        if e.bloccato {
            return true;
        }
        match e.genitore {
            Some(g) => i = g,
            None => return false,
        }
    }
    false
}

/// Il primo dei campioni `nomi` che un oggetto bloccato (lui o un antenato) usa come riempimento o
/// contorno, se c'è: unirlo riscriverebbe l'oggetto, e la fusione non si fa.
pub(crate) fn usato_da_un_bloccato(
    copia: &crate::apertura::Copia,
    nomi: &[&str],
) -> Option<String> {
    use vectorcraft_doc::swatches::node_paints;
    copia
        .mappa
        .elementi()
        .iter()
        .enumerate()
        .find_map(|(i, e)| {
            let nodo = e.nodo?;
            if !bloccato_con_antenati(&copia.mappa, i) {
                return None;
            }
            let b = copia.documento.node(nodo)?;
            node_paints(b).find_map(|p| match p {
                Paint::Solid {
                    swatch: Some(nome), ..
                } if nomi.contains(&nome.as_str()) => Some(nome.clone()),
                _ => None,
            })
        })
}

/// Vero se il comando ha sciolto da un campione, o ha legato a un altro, un
/// colore di un oggetto bloccato (lui o un antenato): eliminare o unire un
/// campione che un oggetto bloccato usa riscriverebbe l'oggetto.
pub(crate) fn tolto_a_un_bloccato(copia: &crate::apertura::Copia, dopo: &Document) -> bool {
    use vectorcraft_doc::swatches::node_paints;
    let mappa = &copia.mappa;
    let bloccato = |i: usize| bloccato_con_antenati(mappa, i);
    // Il campione a cui un colore è legato: se il comando lo toglie o lo cambia con un altro (la
    // fusione), l'oggetto bloccato cambia.
    let campione = |p: &Paint| match p {
        Paint::Solid {
            swatch: Some(nome), ..
        } => Some(nome.clone()),
        _ => None,
    };
    mappa.elementi().iter().enumerate().any(|(i, e)| {
        let Some(nodo) = e.nodo else { return false };
        let (Some(b), Some(a)) = (copia.documento.node(nodo), dopo.node(nodo)) else {
            return false;
        };
        bloccato(i)
            && node_paints(b)
                .zip(node_paints(a))
                .any(|(x, y)| campione(x).is_some() && campione(x) != campione(y))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_riferimento_si_legge_col_ripiego_e_senza() {
        assert_eq!(riferimento("url(#r1a2b3c4d) #0072b2"), Some("r1a2b3c4d"));
        assert_eq!(riferimento(" url( #r1a2b3c4d)"), Some("r1a2b3c4d"));
        assert_eq!(riferimento("#0072b2"), None);
        assert_eq!(riferimento("url(r1)"), None);
    }

    #[test]
    fn un_colore_legato_si_scrive_col_riferimento() {
        let campioni = CampioniDelFile {
            elenco: vec![Campione {
                id: "r1a2b3c4d".into(),
                nome: "Blu".into(),
                colore: "#0072b2".into(),
                genitore: Some("fub-defs".into()),
                gruppo: None,
            }],
            ..CampioniDelFile::default()
        };
        let r = Riferimenti::del_file(&campioni);
        let legato = Paint::Solid {
            color: Color::from_hex("#0072b2").unwrap_or(Color::BLACK),
            swatch: Some("Blu".into()),
            tint: 1.0,
        };
        assert_eq!(
            r.scrivi(Some(&legato)).as_deref(),
            Some("url(#r1a2b3c4d) #0072b2")
        );
        assert_eq!(r.scrivi(None).as_deref(), Some("none"));
        let sciolto = Paint::solid(Color::from_hex("#0072b2").unwrap_or(Color::BLACK));
        assert_eq!(r.scrivi(Some(&sciolto)).as_deref(), Some("#0072b2"));
        assert!(!r.uguali(Some(&legato), Some(&sciolto)));
        assert!(r.stesso_campione(Some(&legato), Some(&legato)));
    }
}
