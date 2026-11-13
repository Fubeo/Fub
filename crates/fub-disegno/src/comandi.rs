//! I comandi del disegno (`fub_abi::DRAWING_COMMANDS`) fatti con i comandi del
//! motore, sulla selezione data.
//!
//! - `disegno.colore-tratto` → `paint.setStroke` del motore, col colore
//!   `#rrggbb` (o `#rgb`), o `none`;
//! - `disegno.colore-riempimento` → `paint.setFill`, col colore, o `null` (o
//!   `none`) per nessun riempimento;
//! - `disegno.spessore` → `stroke.set` con `weight`, un numero finito, zero o
//!   più, nelle unità dell'elemento (come `stroke-width` lo scrive il client).
//!
//! **Chi si colora** è ciò che colora oggi il pannello del client
//! (`partsFrom` in `apps/client/src/editors/spatial/tools/look/read.ts` e
//! `lookOps` in `look/write.ts`): un gruppo o un link scelto passa ai suoi
//! discendenti, salvo quelli bloccati; il colore del tratto va nel `stroke`
//! delle forme che hanno un contorno e nel `fill` dei tratti a penna e delle
//! linee a spessore variabile, che sono tutti riempimento; il riempimento va
//! alle forme che ne hanno uno e ai testi; lo spessore ai contorni che si
//! vedono e alle linee a spessore variabile (`parts.widths`). Gli altri
//! elementi (un'immagine, la carta, un livello, un tratto a penna per lo
//! spessore) restano come sono. Il motore riceve sempre gli oggetti uno per
//! uno (`ids`), mai la sua selezione.
//!
//! **Che cosa si rifiuta.** Un id della selezione che non è nella mappa, o
//! che il motore non sa modificare, è `unmapped`, e niente cambia; lo è
//! anche un discendente da colorare che il motore non ha. Un elemento scelto
//! bloccato (lui o un antenato) è `locked`. Una selezione in cui niente si
//! colora, o un comando che non cambia niente, è `empty`. Un valore che non
//! è un colore o uno spessore è `BadArgs`.
//!
//! **Come lo scrive il client.** Un colore dato a chi non aveva quel tratto
//! o quel riempimento (`fill="none"`, nessun `stroke`) è il solo `stroke` o
//! `fill`, senza lo spessore che il motore gli dà. Lo spessore di una freccia
//! riscrive anche il `d`, con la punta lunga 3 × lo spessore + 6 sul
//! `fub:geom` ([`d_della_freccia`]); quello di un contorno con un
//! tratteggio del menu del client (a tratti, a punti, tratto e punto)
//! rimisura lo `stroke-dasharray` sul nuovo spessore, come `dashValue`; un
//! tratteggio che il menu non conosce resta com'è. Il riempimento di un
//! testo è il `fill` del `<text>`. Lo spessore di una linea a spessore
//! variabile non passa dal motore: tutto il profilo si riscala e il contorno
//! pieno si ricalcola, come `widthTo` del client ([`crate::profilo`]), e si
//! scrivono `fub:geom` e `d`; uno spessore 0 la lascia com'è.
//!
//! **L'esito** è la differenza fra la copia e il documento del motore dopo i
//! comandi ([`crate::differenza`]); la sessione torna poi alla copia. Lo
//! stato vero è il file, che le operazioni cambiano.
//!
//! [`controlla_registro`] dice se il registro dei comandi del motore ha
//! ancora gli id e i parametri che si usano qui: un aggiornamento del motore
//! che li cambia fa fallire la sua prova.

use std::collections::{HashMap, HashSet};

use fub_abi::{
    DrawingCommandInfo, DrawingCommandRequest, DrawingOutcome, DrawingRefusal, PluginError,
    DRAWING_COMMANDS, DRAWING_COMMAND_FILL_COLOR, DRAWING_COMMAND_STROKE_COLOR,
    DRAWING_COMMAND_WIDTH,
};
use fub_scene::Role;
use serde_json::{json, Value};
use vectorcraft_doc::color::Color;
use vectorcraft_doc::{LineCap, NodeId};

use crate::apertura::Copia;
use crate::differenza::{self, numero};
use crate::gesti::forme::d_della_freccia;
use crate::gesti::{esito_vuoto, Banco};

/// Il comando del motore che colora il tratto.
pub const MOTORE_TRATTO: &str = "paint.setStroke";
/// Il comando del motore che colora il riempimento.
pub const MOTORE_RIEMPIMENTO: &str = "paint.setFill";
/// Il comando del motore che cambia lo spessore.
pub const MOTORE_SPESSORE: &str = "stroke.set";

/// I comandi di Fub e il comando del motore che li fa. Il colore del tratto
/// dei tratti a penna passa anche da [`MOTORE_RIEMPIMENTO`].
pub const COMANDI: [(&str, &str); 3] = [
    (DRAWING_COMMAND_STROKE_COLOR, MOTORE_TRATTO),
    (DRAWING_COMMAND_FILL_COLOR, MOTORE_RIEMPIMENTO),
    (DRAWING_COMMAND_WIDTH, MOTORE_SPESSORE),
];

/// Ciò che un comando di Fub chiede, letto dal suo `value`.
#[derive(Clone, Debug, PartialEq)]
pub enum Azione {
    /// Il colore del tratto: `#rrggbb`, o `None` per nessuno.
    Tratto(Option<String>),
    /// Il colore del riempimento: `#rrggbb`, o `None` per nessuno.
    Riempimento(Option<String>),
    /// Lo spessore, nelle unità dell'elemento.
    Spessore(f64),
}

impl Azione {
    /// L'azione di `richiesta`, già passata da `validate()`: `Ok(None)` se il
    /// motore non serve il suo id, `BadArgs` se il valore non è un colore o
    /// uno spessore.
    pub fn di(richiesta: &DrawingCommandRequest) -> Result<Option<Azione>, PluginError> {
        let leggi = |nullo: bool| -> Result<Option<String>, PluginError> {
            match &richiesta.value {
                Value::Null if nullo => Ok(None),
                Value::String(s) => colore(s),
                _ => Err(PluginError::BadArgs(
                    "`value` must be a color".to_string().into(),
                )),
            }
        };
        Ok(Some(match richiesta.id.as_str() {
            DRAWING_COMMAND_STROKE_COLOR => Azione::Tratto(leggi(false)?),
            DRAWING_COMMAND_FILL_COLOR => Azione::Riempimento(leggi(true)?),
            DRAWING_COMMAND_WIDTH => match richiesta.value.as_f64() {
                Some(w) if w.is_finite() && w >= 0.0 => Azione::Spessore(w),
                _ => {
                    return Err(PluginError::BadArgs(
                        "`value` must be a finite number, 0 or more"
                            .to_string()
                            .into(),
                    ))
                }
            },
            _ => return Ok(None),
        }))
    }

    fn specie(&self) -> Specie {
        match self {
            Azione::Tratto(_) => Specie::Tratto,
            Azione::Riempimento(_) => Specie::Riempimento,
            Azione::Spessore(_) => Specie::Spessore,
        }
    }
}

/// `none`, la parola chiave di SVG, è nessun colore; poi `#rgb` o `#rrggbb`,
/// scritto `#rrggbb`. Il resto (un nome CSS, `rgb(…)`, l'alfa) è `BadArgs`:
/// il motore lo leggerebbe a modo suo, o perderebbe l'alfa.
fn colore(s: &str) -> Result<Option<String>, PluginError> {
    let t = s.trim();
    if t == "none" {
        return Ok(None);
    }
    let cifre = t.strip_prefix('#').unwrap_or("");
    if matches!(cifre.len(), 3 | 6) && cifre.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Some(c) = Color::from_hex(t) {
            return Ok(Some(c.to_hex()));
        }
    }
    Err(PluginError::BadArgs(
        format!("`value` must be #rgb, #rrggbb or none, not {s:?}").into(),
    ))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Specie {
    Tratto,
    Riempimento,
    Spessore,
}

/// Un oggetto del motore da cambiare.
#[derive(Clone, Copy, Debug)]
struct Bersaglio {
    elemento: usize,
    nodo: NodeId,
    /// Il colore del tratto va nel riempimento (un tratto a penna).
    nel_riempimento: bool,
    /// Una linea a spessore variabile per lo spessore: la scrive Fub, non il
    /// motore.
    variabile: bool,
}

/// I ruoli che passano tutto ai figli (`CONTAINERS` del client).
fn contenitore(r: Role) -> bool {
    matches!(r, Role::Group | Role::Link)
}

/// I ruoli con un riempimento (`FILLED` del client).
fn riempito(r: Role) -> bool {
    matches!(
        r,
        Role::Ngon
            | Role::Star
            | Role::Path
            | Role::Rect
            | Role::Ellipse
            | Role::Circle
            | Role::Polyline
            | Role::Polygon
            | Role::Text
    )
}

/// I ruoli con un contorno (`OUTLINED` del client).
fn contornato(r: Role) -> bool {
    matches!(
        r,
        Role::Arrow
            | Role::Connector
            | Role::Ngon
            | Role::Star
            | Role::Path
            | Role::Rect
            | Role::Ellipse
            | Role::Circle
            | Role::Line
            | Role::Polyline
            | Role::Polygon
    )
}

/// I ruoli tutti riempimento che si vedono come una linea (`INKED` del
/// client): il loro colore del tratto è il riempimento.
fn inchiostro(r: Role) -> bool {
    matches!(r, Role::Stroke | Role::Width)
}

/// Vero se l'elemento `i` o un suo antenato è bloccato.
fn bloccato(copia: &Copia, mut i: usize) -> bool {
    while let Some(e) = copia.mappa.elemento(i) {
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

/// Gli oggetti del motore che il comando cambia, o perché no.
fn bersagli(
    copia: &Copia,
    selezione: &[String],
    specie: Specie,
) -> Result<Vec<Bersaglio>, DrawingRefusal> {
    if !copia.modificabile {
        return Err(DrawingRefusal::Unsupported);
    }
    if selezione.is_empty() {
        return Err(DrawingRefusal::Empty);
    }
    let mappa = &copia.mappa;
    let mut scelti = Vec::with_capacity(selezione.len());
    for id in selezione {
        let i = mappa.dell_id(id).ok_or(DrawingRefusal::Unmapped)?;
        let e = mappa.elemento(i).ok_or(DrawingRefusal::Unmapped)?;
        if e.nodo.is_none() {
            return Err(DrawingRefusal::Unmapped);
        }
        if bloccato(copia, i) {
            return Err(DrawingRefusal::Locked);
        }
        scelti.push(i);
    }
    // I figli di ogni elemento, solo se un contenitore è scelto.
    let figli: Option<HashMap<usize, Vec<usize>>> = scelti
        .iter()
        .any(|&i| mappa.elemento(i).is_some_and(|e| contenitore(e.ruolo)))
        .then(|| {
            let mut figli: HashMap<usize, Vec<usize>> = HashMap::new();
            for (i, e) in mappa.elementi().iter().enumerate() {
                if let Some(g) = e.genitore {
                    figli.entry(g).or_default().push(i);
                }
            }
            figli
        });
    let mut fuori = Vec::new();
    let mut visti = HashSet::new();
    let mut pila: Vec<(usize, bool)> = scelti.iter().rev().map(|&i| (i, true)).collect();
    while let Some((i, scelto)) = pila.pop() {
        let Some(e) = mappa.elemento(i) else { continue };
        // Ciò che è bloccato dentro un gruppo scelto resta com'è.
        if !scelto && e.bloccato {
            continue;
        }
        if contenitore(e.ruolo) {
            if let Some(dentro) = figli.as_ref().and_then(|f| f.get(&i)) {
                pila.extend(dentro.iter().rev().map(|&c| (c, false)));
            }
            continue;
        }
        let variabile = specie == Specie::Spessore && e.ruolo == Role::Width;
        let nel_riempimento = match specie {
            Specie::Tratto if inchiostro(e.ruolo) => true,
            Specie::Tratto if contornato(e.ruolo) => false,
            Specie::Riempimento if riempito(e.ruolo) => true,
            // Il profilo riscalato (`widthTo` del client).
            Specie::Spessore if variabile => false,
            Specie::Spessore if contornato(e.ruolo) => false,
            // Un tratto a penna non ha uno spessore da pannello.
            _ => continue,
        };
        let nodo = e.nodo.ok_or(DrawingRefusal::Unmapped)?;
        if specie == Specie::Spessore && !variabile {
            // Solo i contorni che si vedono.
            let visibile = copia
                .documento
                .node(nodo)
                .and_then(|n| n.appearance.stroke())
                .is_some_and(|t| !t.paint.is_none());
            if !visibile {
                continue;
            }
        }
        if visti.insert(i) {
            fuori.push(Bersaglio {
                elemento: i,
                nodo,
                nel_riempimento,
                variabile,
            });
        }
    }
    if fuori.is_empty() {
        return Err(DrawingRefusal::Empty);
    }
    Ok(fuori)
}

/// I comandi del disegno sulla selezione: acceso quello che, sulla copia di
/// adesso, ha qualcosa da cambiare e niente che il motore non sappia fare.
pub(crate) fn elenco(copia: &Copia, selezione: &[String]) -> Vec<DrawingCommandInfo> {
    DRAWING_COMMANDS
        .iter()
        .map(|id| {
            let specie = match *id {
                DRAWING_COMMAND_STROKE_COLOR => Some(Specie::Tratto),
                DRAWING_COMMAND_FILL_COLOR => Some(Specie::Riempimento),
                DRAWING_COMMAND_WIDTH => Some(Specie::Spessore),
                _ => None,
            };
            DrawingCommandInfo {
                id: (*id).to_string(),
                enabled: specie.is_some_and(|s| bersagli(copia, selezione, s).is_ok()),
            }
        })
        .collect()
}

/// I parametri di [`MOTORE_TRATTO`] e [`MOTORE_RIEMPIMENTO`]. `focus: false`
/// lascia la sessione com'era (il riquadro attivo del motore).
fn parametri_colore(colore: Option<&str>, ids: &[u64]) -> Value {
    match colore {
        Some(c) => json!({ "color": c, "ids": ids, "focus": false }),
        None => json!({ "none": true, "ids": ids, "focus": false }),
    }
}

/// I parametri di [`MOTORE_SPESSORE`]: lo spessore nel documento del motore.
fn parametri_spessore(peso: f64, ids: &[u64]) -> Value {
    json!({ "weight": peso, "ids": ids })
}

/// I comandi del motore che fanno `azione` sui `bersagli`.
fn chiamate(
    copia: &Copia,
    azione: &Azione,
    bersagli: &[Bersaglio],
) -> Result<Vec<(&'static str, Value)>, DrawingRefusal> {
    let ids = |filtro: &dyn Fn(&Bersaglio) -> bool| -> Vec<u64> {
        bersagli
            .iter()
            .filter(|b| filtro(b))
            .map(|b| b.nodo.0)
            .collect()
    };
    let mut fuori = Vec::new();
    match azione {
        Azione::Tratto(c) => {
            let tratti = ids(&|b| !b.nel_riempimento);
            let penne = ids(&|b| b.nel_riempimento);
            if !tratti.is_empty() {
                fuori.push((MOTORE_TRATTO, parametri_colore(c.as_deref(), &tratti)));
            }
            if !penne.is_empty() {
                fuori.push((MOTORE_RIEMPIMENTO, parametri_colore(c.as_deref(), &penne)));
            }
        }
        Azione::Riempimento(c) => {
            fuori.push((
                MOTORE_RIEMPIMENTO,
                parametri_colore(c.as_deref(), &ids(&|_| true)),
            ));
        }
        Azione::Spessore(w) => {
            // Lo spessore del motore è nel suo documento: quello dell'elemento
            // per la sua scala, come la differenza lo riscrive. Una chiamata
            // per scala.
            let mut per_scala: Vec<(f64, Vec<u64>)> = Vec::new();
            for b in bersagli.iter().filter(|b| !b.variabile) {
                let scala = copia
                    .mappa
                    .elemento(b.elemento)
                    .and_then(|e| e.ctm())
                    .map(|m| m.determinant().abs().sqrt())
                    .filter(|s| s.is_finite() && *s > 0.0)
                    .ok_or(DrawingRefusal::Unsupported)?;
                match per_scala.iter_mut().find(|(s, _)| *s == scala) {
                    Some((_, lista)) => lista.push(b.nodo.0),
                    None => per_scala.push((scala, vec![b.nodo.0])),
                }
            }
            for (scala, lista) in per_scala {
                fuori.push((MOTORE_SPESSORE, parametri_spessore(w * scala, &lista)));
            }
        }
    }
    Ok(fuori)
}

/// Fa `azione` sulla selezione di `richiesta`, sulla copia: l'esito con le
/// operazioni, o il rifiuto. La sessione torna alla copia.
pub(crate) fn esegui(
    banco: &mut Banco,
    copia: &Copia,
    testo: &str,
    richiesta: &DrawingCommandRequest,
    azione: &Azione,
) -> DrawingOutcome {
    let mut esito = esito_vuoto(richiesta.revision);
    let rifiuta = |mut esito: DrawingOutcome, r: DrawingRefusal| {
        esito.refused = Some(r);
        esito
    };
    let (presi, lista) = match bersagli(copia, &richiesta.selection, azione.specie())
        .and_then(|b| chiamate(copia, azione, &b).map(|l| (b, l)))
    {
        Ok(x) => x,
        Err(r) => return rifiuta(esito, r),
    };
    let mut differenza = if lista.is_empty() {
        // Solo linee a spessore variabile: il motore non serve.
        differenza::Differenza::default()
    } else {
        match col_motore(banco, copia, &lista) {
            Ok(d) => d,
            Err(r) => return rifiuta(esito, r),
        }
    };
    if let Azione::Spessore(w) = azione {
        let ids = &differenza.ids;
        if let Err(r) = punte_e_tratteggi(&mut differenza.ops, ids, copia, &presi, testo) {
            return rifiuta(esito, r);
        }
        if let Err(r) = linee_variabili(&mut differenza, copia, &presi, testo, *w) {
            return rifiuta(esito, r);
        }
    } else {
        senza_spessore(&mut differenza.ops);
    }
    match differenza.testo() {
        Ok(Some(ops)) => esito.ops = Some(ops),
        Ok(None) => return rifiuta(esito, DrawingRefusal::Empty),
        Err(r) => return rifiuta(esito, r.rifiuto()),
    }
    // Un comando non cambia la selezione.
    esito.selection = richiesta.selection.clone();
    esito
}

/// Fa le chiamate `lista` sul motore, dalla copia: la differenza, o il
/// rifiuto. La sessione torna alla copia.
fn col_motore(
    banco: &mut Banco,
    copia: &Copia,
    lista: &[(&'static str, Value)],
) -> Result<differenza::Differenza, DrawingRefusal> {
    // Un gesto lasciato a metà non entra nel comando.
    if banco.in_corso.is_some() {
        banco.ripristina(copia);
    }
    let sessione = &mut banco.sessione;
    let fatto = vectorcraft_engine::guard::catch_panic(|| {
        // I comandi del motore cambiano anche lo stile delle forme nuove:
        // quello della sessione resta com'era.
        let stile = sessione.paint.clone();
        let mut fatto = Ok(());
        for (id, parametri) in lista {
            if let Err(e) = sessione.execute(id, parametri) {
                fatto = Err(e);
                break;
            }
        }
        sessione.paint = stile;
        fatto
    });
    if !matches!(fatto, Ok(Ok(()))) {
        banco.ripristina(copia);
        return Err(DrawingRefusal::Unsupported);
    }
    let Some(dopo) = banco.documento() else {
        banco.ripristina(copia);
        return Err(DrawingRefusal::Unsupported);
    };
    let differenza =
        vectorcraft_engine::guard::catch_panic(|| differenza::differenza(copia, &dopo, None, None));
    banco.ripristina(copia);
    match differenza {
        Ok(Ok(d)) => Ok(d),
        Ok(Err(r)) => Err(r.rifiuto()),
        Err(_) => Err(DrawingRefusal::Unsupported),
    }
}

/// I tratteggi del menu del client, in spessori, come si vedono (`PATTERNS`
/// di `apps/client/src/editors/spatial/tools/outline.ts`).
const TRATTEGGI: [&[f64]; 3] = [&[4.0, 3.0], &[1.0, 2.0], &[4.0, 2.0, 1.0, 2.0]];

/// `stroke-dasharray` del tratteggio `motivo` su un contorno spesso
/// `spessore` con gli estremi `estremi` (`dashValue` del client): un
/// estremo arrotondato o quadrato toglie mezzo spessore per parte al
/// trattino e lo dà allo spazio.
fn valore_del_tratteggio(motivo: &[f64], spessore: f64, estremi: LineCap) -> String {
    let fine = if estremi == LineCap::Butt {
        0.0
    } else {
        spessore
    };
    motivo
        .iter()
        .enumerate()
        .map(|(i, parte)| {
            let v = if i % 2 == 0 {
                (parte * spessore - fine).max(0.0)
            } else {
                parte * spessore + fine
            };
            numero(v, 2)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Ciò che il pannello del client riscrive con lo spessore oltre a
/// `stroke-width` (`lookOps` in `tools/look/write.ts`): il `d` di una
/// freccia, la cui punta è lunga 3 × lo spessore + 6 (`arrowPath`, dal suo
/// `fub:geom`), e il tratteggio del menu che il contorno aveva, rimisurato
/// sul nuovo spessore (`dashOf`, `dashValue`). Un tratteggio che non è del
/// menu resta com'è, come nel client. Tocca solo i `set` che scrivono
/// `stroke-width`: uno spessore che non cambia non riscrive niente.
fn punte_e_tratteggi(
    ops: &mut [Value],
    ids: &HashMap<NodeId, String>,
    copia: &Copia,
    presi: &[Bersaglio],
    testo: &str,
) -> Result<(), DrawingRefusal> {
    let mut scena: Option<fub_scene::Scene> = None;
    for b in presi {
        let Some(e) = copia.mappa.elemento(b.elemento) else {
            continue;
        };
        let Some(id) = e.id.clone().or_else(|| ids.get(&b.nodo).cloned()) else {
            continue;
        };
        let Some(attrs) = ops
            .iter_mut()
            .find(|op| op["op"] == "set" && op["id"] == id.as_str())
            .and_then(|op| op.get_mut("attrs"))
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        let Some(spessore) = attrs
            .get("stroke-width")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<f64>().ok())
        else {
            continue;
        };
        if e.ruolo == Role::Arrow {
            if scena.is_none() {
                scena = Some(fub_scene::read(testo).map_err(|_| DrawingRefusal::Unsupported)?);
            }
            let geom = scena.as_ref().and_then(|s| {
                s.items.iter().find_map(|i| match i {
                    fub_scene::Item::Element(x) if x.path == e.percorso => x.arrow,
                    _ => None,
                })
            });
            if let Some([x1, y1, x2, y2]) = geom {
                attrs.insert("d".into(), json!(d_della_freccia(x1, y1, x2, y2, spessore)));
            }
        }
        let tratto = copia
            .documento
            .node(b.nodo)
            .and_then(|n| n.appearance.stroke());
        let (Some(tratto), Some(m)) = (tratto, e.ctm()) else {
            continue;
        };
        let Some(trattini) = tratto.dash.as_ref() else {
            continue;
        };
        let scala = m.determinant().abs().sqrt();
        if !(scala.is_finite() && scala > 0.0) {
            continue;
        }
        let scritto = trattini
            .pattern
            .iter()
            .map(|v| numero(v / scala, 2))
            .collect::<Vec<_>>()
            .join(" ");
        let prima = tratto.width / scala;
        if let Some(motivo) = TRATTEGGI
            .iter()
            .find(|m| valore_del_tratteggio(m, prima, tratto.cap) == scritto)
        {
            let nuovo = valore_del_tratteggio(motivo, spessore, tratto.cap);
            if nuovo != scritto {
                attrs.insert("stroke-dasharray".into(), json!(nuovo));
            }
        }
    }
    Ok(())
}

/// Lo spessore `spessore` sulle linee a spessore variabile fra i `presi`
/// (`widthTo` di `tools/look/write.ts`): il profilo riscalato perché il
/// punto più largo sia spesso `spessore`, nelle unità della linea, e il
/// contorno pieno ricalcolato ([`crate::profilo`]); si scrivono `fub:geom` e
/// `d` se `fub:geom` cambia. Uno spessore 0, o un contorno che non riesce,
/// la lascia com'è, come nel client. Una linea senza id ne riceve uno con
/// `ident`.
fn linee_variabili(
    differenza: &mut differenza::Differenza,
    copia: &Copia,
    presi: &[Bersaglio],
    testo: &str,
    spessore: f64,
) -> Result<(), DrawingRefusal> {
    if !presi.iter().any(|b| b.variabile) {
        return Ok(());
    }
    let scena = fub_scene::read(testo).map_err(|_| DrawingRefusal::Unsupported)?;
    let mut nuovi: Vec<Value> = Vec::new();
    let mut ident: Vec<Value> = Vec::new();
    for b in presi.iter().filter(|b| b.variabile) {
        let Some(e) = copia.mappa.elemento(b.elemento) else {
            continue;
        };
        let Some(item) = scena.items.iter().find_map(|i| match i {
            fub_scene::Item::Element(x) if x.path == e.percorso => Some(x),
            _ => None,
        }) else {
            continue;
        };
        let Some(v) = item.varwidth.as_ref() else {
            continue;
        };
        let Some(scritto) = crate::profilo::con_spessore(v, spessore) else {
            continue;
        };
        let grezzo = attributo_grezzo(testo, item.span.bytes[0], "fub:geom");
        if grezzo.as_deref() == Some(scritto.geom.as_str()) {
            continue;
        }
        let gia = differenza.ids.get(&b.nodo).map(String::as_str);
        let id = match (e.id_del_file(), gia) {
            (Some(id), _) | (None, Some(id)) => id.to_string(),
            (None, None) => {
                let dati = &differenza.ids;
                let id = crate::id::nuovo(crate::id::Specie::Oggetto, &|id| {
                    copia.mappa.id_preso(id) || dati.values().any(|d| d == id)
                })
                .ok_or(DrawingRefusal::Unsupported)?;
                ident.push(json!({ "op": "ident", "path": e.percorso, "tag": e.tag, "id": id }));
                differenza.ids.insert(b.nodo, id.clone());
                id
            }
        };
        nuovi.push(json!({
            "op": "set",
            "id": id,
            "attrs": { "fub:geom": scritto.geom, "d": scritto.d },
        }));
    }
    if nuovi.is_empty() {
        return Ok(());
    }
    // Gli `ident` vanno prima di tutto, dopo quelli della differenza.
    let dopo_gli_ident = differenza
        .ops
        .iter()
        .take_while(|op| op["op"] == "ident")
        .count();
    differenza.ops.splice(dopo_gli_ident..dopo_gli_ident, ident);
    differenza.ops.extend(nuovi);
    crate::perdite::controlla(&copia.perdite, &differenza.ops).map_err(|_| DrawingRefusal::Unmapped)
}

/// Il valore dell'attributo `nome` del tag che comincia al byte `inizio` di
/// `testo`, com'è dopo la lettura XML: i riferimenti risolti e le fini di
/// riga e le tabulazioni come spazi. `None` se il tag non lo scrive con quel
/// nome: allora `fub:geom` si riscrive comunque.
fn attributo_grezzo(testo: &str, inizio: usize, nome: &str) -> Option<String> {
    let b = testo.as_bytes();
    let spazi = |mut i: usize| {
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        i
    };
    if b.get(inizio) != Some(&b'<') {
        return None;
    }
    let mut i = inizio + 1;
    // Il nome del tag.
    while i < b.len() && !b[i].is_ascii_whitespace() && !matches!(b[i], b'>' | b'/') {
        i += 1;
    }
    loop {
        i = spazi(i);
        if i >= b.len() || matches!(b[i], b'>' | b'/') {
            return None;
        }
        let da = i;
        while i < b.len() && b[i] != b'=' && !b[i].is_ascii_whitespace() {
            i += 1;
        }
        let questo = &testo[da..i];
        i = spazi(i);
        if b.get(i) != Some(&b'=') {
            return None;
        }
        i = spazi(i + 1);
        let virgolette = *b.get(i)?;
        if !matches!(virgolette, b'"' | b'\'') {
            return None;
        }
        let da = i + 1;
        let fine = da + testo.get(da..)?.find(char::from(virgolette))?;
        if questo == nome {
            return valore_xml(&testo[da..fine]);
        }
        i = fine + 1;
    }
}

/// Un valore d'attributo XML com'è dopo la lettura: le fini di riga e le
/// tabulazioni diventano spazi, i riferimenti si risolvono.
fn valore_xml(grezzo: &str) -> Option<String> {
    let mut out = String::with_capacity(grezzo.len());
    let mut resto = grezzo;
    while let Some(c) = resto.chars().next() {
        match c {
            '&' => {
                let fine = resto.find(';')?;
                let entita = &resto[1..fine];
                out.push(match entita {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" => '\'',
                    _ => {
                        let codice = match entita.strip_prefix("#x") {
                            Some(x) => u32::from_str_radix(x, 16).ok()?,
                            None => entita.strip_prefix('#')?.parse().ok()?,
                        };
                        char::from_u32(codice)?
                    }
                });
                resto = &resto[fine + 1..];
                continue;
            }
            '\r' if resto[1..].starts_with('\n') => {
                out.push(' ');
                resto = &resto[2..];
                continue;
            }
            '\r' | '\n' | '\t' => out.push(' '),
            _ => out.push(c),
        }
        resto = &resto[c.len_utf8()..];
    }
    Some(out)
}

/// Toglie `stroke-width` dai `set` di un comando di colore. Il motore, che
/// tiene lo spessore nel tratto, lo porta a 0 togliendo il tratto e a 1
/// dandolo a chi non l'aveva; il client cambia solo il colore, e il file
/// tiene lo spessore che aveva. Un `set` rimasto senza attributi se ne va.
fn senza_spessore(ops: &mut Vec<Value>) {
    for op in ops.iter_mut() {
        if op["op"] == "set" {
            if let Some(attrs) = op.get_mut("attrs").and_then(Value::as_object_mut) {
                attrs.remove("stroke-width");
            }
        }
    }
    ops.retain(|op| op["op"] != "set" || op["attrs"].as_object().is_some_and(|a| !a.is_empty()));
    // Un `ident` che nessun'altra operazione nomina più non serve.
    let nominati: HashSet<String> = ops
        .iter()
        .filter(|op| op["op"] != "ident")
        .filter_map(|op| op["id"].as_str().map(str::to_string))
        .collect();
    ops.retain(|op| {
        op["op"] != "ident" || op["id"].as_str().is_some_and(|id| nominati.contains(id))
    });
}

/// I comandi del motore con i parametri come li manda questo modulo, uno
/// per forma: ciò che [`controlla_registro`] verifica.
pub fn chiamate_di_prova() -> Vec<(&'static str, Value)> {
    vec![
        (MOTORE_TRATTO, parametri_colore(Some("#ff0000"), &[1])),
        (MOTORE_TRATTO, parametri_colore(None, &[1])),
        (MOTORE_RIEMPIMENTO, parametri_colore(Some("#ff0000"), &[1])),
        (MOTORE_RIEMPIMENTO, parametri_colore(None, &[1])),
        (MOTORE_SPESSORE, parametri_spessore(2.0, &[1])),
    ]
}

/// `Ok` se il registro dei comandi del motore ha `id` e la sua descrizione
/// nomina ogni chiave di `parametri` (`chiave?` o `chiave:`, anche nella
/// descrizione dei comandi che nomina con «as …»); altrimenti il perché.
///
/// Il controllo delle chiavi del motore (`check_params`) salta proprio questi
/// comandi (la lista `UNCHECKED` di `cmd/params.rs`): per questo si legge qui
/// la descrizione, e si chiama anche `check_params` per quando il motore li
/// controllerà.
pub fn controlla_registro(id: &str, parametri: &Value) -> Result<(), String> {
    let spec = vectorcraft_engine::find_command(id)
        .ok_or_else(|| format!("il motore non ha più il comando `{id}`"))?;
    // La descrizione, e quella dei comandi a cui rimanda («…as paint.setFill»).
    let mut descrizioni = vec![spec.params];
    for pezzo in spec.params.split("as ").skip(1) {
        let nome: String = pezzo
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '.')
            .collect();
        if let Some(altro) = vectorcraft_engine::find_command(nome.trim_end_matches('.')) {
            descrizioni.push(altro.params);
        }
    }
    let nomina = |chiave: &str| {
        descrizioni.iter().any(|d| {
            d.match_indices(chiave).any(|(i, _)| {
                let prima = d[..i].chars().next_back();
                let dopo = d[i + chiave.len()..].chars().next();
                !prima.is_some_and(|c| c.is_ascii_alphanumeric()) && matches!(dopo, Some('?' | ':'))
            })
        })
    };
    if let Some(chiavi) = parametri.as_object() {
        if let Some(chiave) = chiavi.keys().find(|k| !nomina(k)) {
            return Err(format!(
                "il comando `{id}` del motore non nomina più il parametro `{chiave}`"
            ));
        }
    }
    vectorcraft_engine::check_params(id, parametri)
        .map_err(|e| format!("il comando `{id}` del motore non accetta {parametri}: {e}"))
}
