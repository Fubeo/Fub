//! La Selezione del disegno: scegliere, spostare, ridimensionare e ruotare
//! come gli strumenti TypeScript di oggi
//! (`apps/client/src/editors/spatial/tools/editor/selection-gestures.ts`,
//! `tools/frame.ts`, `tools/grid.ts`), che i vettori dei gesti fissano. Lo
//! strumento del motore è la Selezione (`selection` di
//! `vendor/vectorcraft/crates/tools/src/select.rs`); la rotazione la fa lo
//! strumento Ruota (`rotate` di `tools/src/xform/transform.rs`).
//!
//! **La pressione decide il gesto**, con le regole di Fub, sulla selezione di
//! prima e sulla pressione come l'ha mandata Fub ([`Contesto::pressione`]):
//!
//! - una **maniglia** della cornice (`gripAt`: gli otto lati e angoli 4 px
//!   fuori dal riquadro col contorno, la maniglia tonda 24 px sopra il lato
//!   in alto; il puntatore si conta come il mouse, che il contratto non dice)
//!   ridimensiona o ruota;
//! - un **oggetto** sotto il puntatore (l'oggetto più esterno del livello:
//!   un gruppo per un oggetto che sta dentro di lui; un oggetto scelto
//!   dentro un gruppo prende il gesto lui) si sceglie, con Maiusc si
//!   aggiunge o, già scelto, si toglie al rilascio senza trascinare, e
//!   trascinato si sposta con tutta la selezione;
//! - il **vuoto** comincia un riquadro: sceglie gli oggetti che contiene per
//!   intero, in ordine di documento, con Maiusc in più a quelli già scelti.
//!
//! I livelli bloccati e nascosti non si scelgono (il motore non li tocca), e
//! un id della selezione che non c'è più si toglie.
//!
//! **Chi fa che cosa.** Il motore fa il gesto quando il suo strumento fa ciò
//! che Fub fa; gli eventi gli arrivano già con le regole di Fub
//! ([`Strumento::evento`]), senza i modificatori che leggerebbe a modo suo
//! (Maiusc vincola a 45°, Alt copia, Ctrl/⌘ sceglie l'oggetto dietro):
//!
//! - **spostare**: la Selezione del motore prende l'oggetto per l'ancora o il
//!   centro vicini (le guide intelligenti), quindi la pressione gli arriva
//!   lì e ogni punto dopo ne dista lo spostamento di Fub. La griglia è la
//!   regola di `snappedDelta`, applicata agli eventi: l'angolo della
//!   geometria più vicino alla pressione va sull'incrocio più vicino (Ctrl/⌘
//!   la scioglie); senza griglia lo spostamento è a due decimali. L'aggancio
//!   alla griglia del motore resta spento: porta sulle righe i bordi del
//!   riquadro, non l'angolo preso;
//! - **ridimensionare** una cornice dritta senza contorno: la maniglia del
//!   motore, che scala dal lato opposto (con Alt dal centro), riceve il punto
//!   che dà la misura di Fub (`resized`: la misura minima, le proporzioni
//!   degli angoli, la griglia sul bordo tirato);
//! - **ruotare**: lo strumento Ruota del motore gira attorno al centro della
//!   selezione; la pressione gli arriva lontano dal centro sulla stessa
//!   direzione, perché la sua soglia di 3 px non perda le rotazioni piccole, e
//!   ogni punto dopo è girato dell'angolo di Fub (`rotation`: il decimo di
//!   grado, la calamita di 1,5° sugli angoli retti che Ctrl/⌘ toglie, i passi
//!   di 15° con Maiusc).
//!
//! Quando lo strumento del motore farebbe altro, il gesto lo fa Fub e il
//! motore riceve solo passaggi del puntatore: una cornice girata, inclinata o
//! con il contorno (il motore scala lungo i suoi assi e dal bordo della
//! geometria), una pressione dove il motore ha una maniglia sua (le maniglie
//! e la zona di rotazione della sua cornice, i cursori della torta di
//! un'ellisse), un oggetto scelto dentro un gruppo, la carta. La matrice di
//! Fub va sugli oggetti del documento del motore, e la differenza scrive la
//! `transform` nuova come per il motore ([`crate::differenza`]).
//!
//! Il riquadro, che il motore sceglierebbe fra gli oggetti che tocca, lo
//! chiude sempre [`Strumento::rifinisci`] con la regola di Fub.
//!
//! **L'anteprima** ([`Strumento::anteprima`]) è la matrice di Fub della
//! selezione, nelle coordinate della scena, o il riquadro di selezione.
//!
//! **Fuori dalla regola di oggi**: la soglia di trascinamento si guarda sul
//! punto di adesso (Fub ricorda che l'ha passata); più oggetti ruotati non
//! tengono la cornice girata fra un gesto e l'altro; Ctrl/⌘ non sceglie
//! dentro i gruppi.

use fub_abi::{DrawingOutcome, DrawingPointer, DrawingPointerKind, DrawingPreview, DrawingRefusal};
use fub_scene::Role;
use serde_json::Value;
use vectorcraft_doc::hit::{hit_test, marquee, HitOptions};
use vectorcraft_doc::{NodeId, Scaling, Selection};
use vectorcraft_engine::Session;
use vectorcraft_geom::{Affine, Point, Rect, Vec2};
use vectorcraft_tools::bbox::{hit_handle, in_rotate_zone, Handle};
use vectorcraft_tools::pie::PieWidget;

use super::{Contesto, Strumento};
use crate::differenza::{self, numero};
use crate::mappa::Elemento;

/// Il raggio in cui si prende un oggetto, in pixel (`HIT_PX` del mouse).
pub const HIT_PX: f64 = 4.0;
/// Oltre questo spostamento, in pixel, un tocco diventa un trascinamento
/// (`DRAG_PX`).
pub const DRAG_PX: f64 = 3.0;
/// Il margine fra il riquadro e la cornice disegnata, in pixel.
const FRAME_PX: f64 = 4.0;
/// La distanza della maniglia che ruota dal lato in alto, in pixel.
const ROTATE_PX: f64 = 24.0;
/// Sotto questa lunghezza un lato non ha la maniglia di mezzo, in pixel.
const SIDE_PX: f64 = 32.0;
/// Sotto questa misura la cornice è piccola: dentro vince l'oggetto.
const SMALL_PX: f64 = 24.0;
/// Il raggio di una maniglia dentro la cornice, in pixel.
const INSIDE_PX: f64 = 6.0;
/// Il raggio di una maniglia fuori dalla cornice, in pixel (il mouse).
const OUTSIDE_PX: f64 = 8.0;
/// La calamita degli angoli retti, in gradi.
pub const MAGNET_DEGREES: f64 = 1.5;
/// I passi della rotazione con Maiusc, in gradi.
pub const ROTATE_STEP: f64 = 15.0;
/// La misura più piccola di un lato, in unità della scena.
pub const MIN_SIZE: f64 = 1.0;
/// Le tolleranze della Selezione del motore, in pixel: le maniglie della sua
/// cornice, i cursori della torta, la zona di rotazione, l'ancora o il
/// centro che una pressione prende.
const MOTORE_MANIGLIA_PX: f64 = 5.0;
const MOTORE_ROTAZIONE_PX: f64 = 18.0;
const MOTORE_PRESA_PX: f64 = 6.0;
/// Quanto lontano dal centro arriva al motore la pressione di una rotazione,
/// in pixel: a questa distanza un decimo di grado sposta il punto oltre la
/// soglia del motore.
const MOTORE_LEVA_PX: f64 = 100_000.0;

/// La Selezione di Fub.
pub(crate) struct Selezione;

static SELEZIONE: Selezione = Selezione;

/// Lo strumento della selezione.
pub(crate) fn strumento() -> &'static dyn Strumento {
    &SELEZIONE
}

/// La cornice di trasformazione (`Frame`).
#[derive(Clone, Copy, Debug)]
struct Cornice {
    /// Dalle coordinate della cornice alla scena.
    m: Affine,
    /// Il riquadro col contorno.
    scatola: Rect,
    /// Il riquadro della geometria.
    geometria: Rect,
}

/// Una maniglia: un lato o un angolo (`pull` sui due assi), o la rotazione.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Maniglia {
    Lato(i8, i8),
    Ruota,
}

/// Il gesto che la pressione comincia.
#[derive(Clone, Debug)]
enum Gesto {
    Sposta {
        /// La selezione dopo la pressione (indici della mappa).
        dopo: Vec<usize>,
        /// Premuto con Maiusc su un oggetto già scelto: al rilascio senza
        /// trascinare lascia la selezione.
        lascia: Option<usize>,
        /// L'angolo della geometria che la griglia aggancia, nella scena.
        fonte: Option<Point>,
        /// Dove la Selezione del motore prende l'oggetto, nel documento del
        /// motore; `None`: il gesto lo fa Fub.
        motore: Option<Point>,
    },
    Riquadro {
        base: Vec<usize>,
        motore: bool,
    },
    Ridimensiona {
        cornice: Cornice,
        lato: (i8, i8),
        /// Un oggetto che deformato non è più lui: gli angoli tengono le
        /// proporzioni (`RATIO_ROLES`).
        proporzioni: bool,
        /// Il riquadro della cornice del motore e la sua maniglia.
        motore: Option<(Rect, Handle)>,
    },
    Ruota {
        cornice: Cornice,
        perno: Point,
        /// La pressione per il motore e il suo centro, nel documento del
        /// motore.
        motore: Option<(Point, Point)>,
    },
}

/// `Math.round` di JavaScript.
fn round_js(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// Due decimali e niente `-0` (`clean` di `grid.ts`).
fn pulito(v: f64) -> f64 {
    let c = round_js(v * 100.0) / 100.0;
    if c == 0.0 {
        0.0
    } else {
        c
    }
}

/// `roundDelta`: due decimali, come li scrive il client.
fn due_decimali(v: f64) -> f64 {
    numero(v, 2).parse().unwrap_or(0.0)
}

fn sulla_riga(v: f64, passo: f64) -> f64 {
    pulito(round_js(v / passo) * passo)
}

/// `lineBeyond` con un passo: la prima riga che `v` non ha ancora raggiunto.
fn riga_oltre(v: f64, passo: f64, verso: f64) -> f64 {
    const SULLA_RIGA: f64 = 1e-6;
    let at = v / passo;
    let k = if verso > 0.0 {
        (at + SULLA_RIGA).floor() + 1.0
    } else {
        (at - SULLA_RIGA).ceil() - 1.0
    };
    pulito(k * passo)
}

/// I gradi fra -180 escluso e 180.
fn normalizzato(gradi: f64) -> f64 {
    let g = gradi - 360.0 * ((gradi + 180.0) / 360.0).floor();
    if g == -180.0 {
        180.0
    } else if g == 0.0 {
        0.0
    } else {
        g
    }
}

fn lo(r: Rect, asse: usize) -> f64 {
    if asse == 0 {
        r.x0
    } else {
        r.y0
    }
}

fn hi(r: Rect, asse: usize) -> f64 {
    if asse == 0 {
        r.x1
    } else {
        r.y1
    }
}

fn vicini(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6 * (1.0 + a.abs().max(b.abs()))
}

fn rett_vicini(a: Rect, b: Rect) -> bool {
    vicini(a.x0, b.x0) && vicini(a.y0, b.y0) && vicini(a.x1, b.x1) && vicini(a.y1, b.y1)
}

fn unione(a: Option<Rect>, b: Option<Rect>) -> Option<Rect> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.union(b)),
        (a, b) => a.or(b),
    }
}

/// Vero se `fuori` contiene `dentro` (`holdsPath`).
fn contiene(fuori: &[usize], dentro: &[usize]) -> bool {
    dentro.len() > fuori.len() && dentro.starts_with(fuori)
}

fn punto(e: &DrawingPointer) -> Point {
    Point::new(e.x, e.y)
}

/// Gli elementi `indici` come la selezione li tiene (`unitsOf`): in ordine di
/// documento, senza quelli che stanno dentro un altro della lista, solo
/// quelli che il motore ha.
fn in_ordine(cx: &Contesto<'_>, indici: impl IntoIterator<Item = usize>) -> Vec<usize> {
    let mappa = &cx.copia.mappa;
    let mut tutti: Vec<usize> = indici
        .into_iter()
        .filter(|i| mappa.elemento(*i).is_some_and(|e| e.nodo.is_some()))
        .collect();
    tutti.sort_by(|a, b| {
        let pa = mappa.elemento(*a).map(|e| &e.percorso);
        let pb = mappa.elemento(*b).map(|e| &e.percorso);
        pa.cmp(&pb)
    });
    tutti.dedup();
    let mut fuori: Vec<usize> = Vec::new();
    for i in tutti {
        let dentro = fuori.last().is_some_and(|l| {
            let (Some(l), Some(e)) = (mappa.elemento(*l), mappa.elemento(i)) else {
                return false;
            };
            contiene(&l.percorso, &e.percorso)
        });
        if !dentro {
            fuori.push(i);
        }
    }
    fuori
}

/// La selezione prima del gesto, nel suo ordine (che il client tiene); gli
/// id che non ci sono più, o che stanno dentro un altro scelto, restano
/// fuori.
fn scelti(cx: &Contesto<'_>) -> Vec<usize> {
    let mappa = &cx.copia.mappa;
    let validi = in_ordine(
        cx,
        cx.gesto.selection.iter().filter_map(|id| mappa.dell_id(id)),
    );
    let mut fuori: Vec<usize> = Vec::new();
    for i in cx.gesto.selection.iter().filter_map(|id| mappa.dell_id(id)) {
        if validi.contains(&i) && !fuori.contains(&i) {
            fuori.push(i);
        }
    }
    fuori
}

fn elemento<'a>(cx: &Contesto<'a>, i: usize) -> Option<&'a Elemento> {
    cx.copia.mappa.elemento(i)
}

fn nodi(cx: &Contesto<'_>, indici: &[usize]) -> Vec<NodeId> {
    indici
        .iter()
        .filter_map(|i| elemento(cx, *i)?.nodo)
        .collect()
}

/// Gli id di Fub di `indici`; un elemento senza id ha quello che le
/// operazioni `ops` gli danno con `ident`, se no resta fuori.
fn ids_di(cx: &Contesto<'_>, indici: &[usize], ops: Option<&str>) -> Vec<String> {
    fn raccogli(v: &Value, nuovi: &mut Vec<(Vec<usize>, String)>) {
        match v {
            Value::Array(a) => a.iter().for_each(|x| raccogli(x, nuovi)),
            Value::Object(o) if o.get("op").and_then(Value::as_str) == Some("ident") => {
                let percorso = o.get("path").and_then(Value::as_array).map(|p| {
                    p.iter()
                        .filter_map(|i| i.as_u64().and_then(|i| usize::try_from(i).ok()))
                        .collect::<Vec<_>>()
                });
                if let (Some(p), Some(id)) = (percorso, o.get("id").and_then(Value::as_str)) {
                    nuovi.push((p, id.to_string()));
                }
            }
            Value::Object(o) => o.values().for_each(|x| raccogli(x, nuovi)),
            _ => {}
        }
    }
    let mut nuovi = Vec::new();
    if let Some(v) = ops.and_then(|t| serde_json::from_str::<Value>(t).ok()) {
        raccogli(&v, &mut nuovi);
    }
    indici
        .iter()
        .filter_map(|i| {
            let e = elemento(cx, *i)?;
            e.id_del_file().map(str::to_string).or_else(|| {
                nuovi
                    .iter()
                    .find(|(p, _)| *p == e.percorso)
                    .map(|(_, id)| id.clone())
            })
        })
        .collect()
}

/// Le opzioni con cui la Selezione del motore prende gli oggetti (quelle
/// che [`Selezione::prepara`] le dà).
fn opzioni(cx: &Contesto<'_>) -> HitOptions {
    HitOptions {
        tol: HIT_PX / cx.vista.zoom,
        clip_outlines: true,
        ..HitOptions::default()
    }
}

/// Dalla scena al documento del motore e indietro.
fn al_motore(cx: &Contesto<'_>, p: Point) -> Point {
    cx.copia.radice * p
}

fn alla_scena(cx: &Contesto<'_>, p: Point) -> Point {
    cx.copia.radice.inverse() * p
}

/// La cornice di `indici` (`frameOf`): quella dell'oggetto, se è uno solo,
/// se no il riquadro comune nella scena.
fn cornice(cx: &Contesto<'_>, indici: &[usize]) -> Option<Cornice> {
    let doc = &cx.copia.documento;
    let simboli = doc.symbol_boxes();
    if let [i] = indici {
        let e = elemento(cx, *i)?;
        let ctm = e.ctm()?;
        let locale = ctm.inverse();
        if !locale.is_finite() {
            return None;
        }
        let n = doc.node(e.nodo?)?;
        let scatola = n.bounds_in(&simboli, locale, true)?;
        let geometria = n.bounds_in(&simboli, locale, false).unwrap_or(scatola);
        return Some(Cornice {
            m: cx.copia.radice.inverse() * ctm,
            scatola,
            geometria,
        });
    }
    let indietro = cx.copia.radice.inverse();
    let mut scatola = None;
    let mut geometria = None;
    for n in nodi(cx, indici) {
        let Some(n) = doc.node(n) else { continue };
        let s = n.bounds_in(&simboli, indietro, true);
        scatola = unione(scatola, s);
        geometria = unione(geometria, n.bounds_in(&simboli, indietro, false).or(s));
    }
    Some(Cornice {
        m: Affine::IDENTITY,
        scatola: scatola?,
        geometria: geometria.or(scatola)?,
    })
}

/// Le colonne della matrice: quanto è lunga nella scena un'unità della
/// cornice lungo ciascun asse.
fn assi(m: Affine) -> (f64, f64) {
    let [a, b, c, d, _, _] = m.as_coeffs();
    (a.hypot(b), c.hypot(d))
}

fn dritta(m: Affine) -> bool {
    let [_, b, c, _, _, _] = m.as_coeffs();
    b.abs() < 1e-9 && c.abs() < 1e-9
}

/// La maniglia sotto `p` (`frameView` e `gripAt`), alla scala `s`.
fn maniglia(c: &Cornice, p: Point, s: f64) -> Option<Maniglia> {
    let m = c.m;
    let (lx, ly) = assi(m);
    if s.is_nan() || s <= 0.0 || lx == 0.0 || ly == 0.0 || m.determinant() == 0.0 {
        return None;
    }
    let (px, py) = (FRAME_PX / (lx * s), FRAME_PX / (ly * s));
    let b = c.scatola;
    let pad = Rect::new(b.x0 - px, b.y0 - py, b.x1 + px, b.y1 + py);
    let misura = (pad.width() * lx * s, pad.height() * ly * s);
    let scala_x = c.geometria.width() > 1e-9 && b.width() > 1e-9;
    let scala_y = c.geometria.height() > 1e-9 && b.height() > 1e-9;
    let angoli = scala_x && scala_y;
    let centro = pad.center();
    let posto = |gx: i8, gy: i8| {
        let x = match gx {
            -1 => pad.x0,
            1 => pad.x1,
            _ => centro.x,
        };
        let y = match gy {
            -1 => pad.y0,
            1 => pad.y1,
            _ => centro.y,
        };
        m * Point::new(x, y)
    };
    let mut posti: Vec<(Maniglia, Point)> = Vec::new();
    for (gx, gy) in [
        (-1, -1),
        (0, -1),
        (1, -1),
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
    ] {
        let mostra = if gx != 0 && gy != 0 {
            angoli
        } else if gx != 0 {
            scala_x && (!angoli || misura.1 >= SIDE_PX)
        } else {
            scala_y && (!angoli || misura.0 >= SIDE_PX)
        };
        if mostra {
            posti.push((Maniglia::Lato(gx, gy), posto(gx, gy)));
        }
    }
    let gambo = m * Point::new(centro.x, pad.y0);
    let [a, bb, _, _, _, _] = m.as_coeffs();
    let lato = Vec2::new(a / lx, bb / lx);
    let mut normale = Vec2::new(lato.y, -lato.x);
    let mezzo = m * centro;
    if normale.dot(gambo - mezzo) < 0.0 {
        normale = -normale;
    }
    posti.push((Maniglia::Ruota, gambo + normale * (ROTATE_PX / s)));
    let inversa = m.inverse();
    let q = inversa * p;
    let dentro = q.x >= pad.x0 && q.x <= pad.x1 && q.y >= pad.y0 && q.y <= pad.y1;
    let piccola = misura.0 < SMALL_PX || misura.1 < SMALL_PX;
    let mut meglio = None;
    let mut vicina = f64::INFINITY;
    for (g, at) in posti {
        let portata = if dentro && g != Maniglia::Ruota {
            if piccola {
                0.0
            } else {
                INSIDE_PX
            }
        } else {
            OUTSIDE_PX
        };
        let d = at.distance(p) * s;
        if d <= portata && d < vicina {
            meglio = Some(g);
            vicina = d;
        }
    }
    meglio
}

/// Vero se a `pe` (documento del motore) la Selezione del motore ha una
/// maniglia sua per la selezione `sel`: la sua cornice, la zona di rotazione
/// fuori dagli angoli, un cursore della torta.
fn maniglia_del_motore(cx: &Contesto<'_>, sel: &[NodeId], pe: Point) -> bool {
    if sel.is_empty() {
        return false;
    }
    let doc = &cx.copia.documento;
    let tol = |px: f64| px / cx.vista.zoom;
    if let Some(bx) = doc.oriented_bounds(sel, false) {
        let lp = bx.to_local(pe);
        if hit_handle(bx.rect, lp, tol(MOTORE_MANIGLIA_PX)).is_some()
            || in_rotate_zone(
                bx.rect,
                lp,
                tol(MOTORE_MANIGLIA_PX),
                tol(MOTORE_ROTAZIONE_PX),
            )
            .is_some()
        {
            return true;
        }
    }
    let mut s = Selection::default();
    sel.iter().for_each(|n| s.add(*n));
    PieWidget::of(doc, &s, cx.vista.zoom)
        .iter()
        .any(|w| w.at.distance(pe) <= tol(MOTORE_MANIGLIA_PX))
}

/// Dove la Selezione del motore prende un oggetto premuto a `pe` (il suo
/// `hover_point`, con le guide intelligenti accese): l'ancora più vicina
/// dell'oggetto sotto il puntatore, o il suo centro, entro 6 px; poi gli
/// oggetti scelti, se la pressione li tiene; se no `pe`.
fn presa_del_motore(cx: &Contesto<'_>, sel: &[NodeId], pe: Point) -> Point {
    let doc = &cx.copia.documento;
    let portata = MOTORE_PRESA_PX / cx.vista.zoom;
    let sotto = hit_test(doc, pe, opzioni(cx)).map(|h| h.top_object(None));
    let scelti: &[NodeId] = if sotto.is_none_or(|u| sel.contains(&u)) {
        sel
    } else {
        &[]
    };
    for id in sotto.into_iter().chain(scelti.iter().copied()) {
        let Some(n) = doc.node(id) else { continue };
        let ancora = n.path_data().and_then(|pd| {
            pd.subpaths
                .iter()
                .flat_map(|sp| sp.anchors.iter().map(|a| a.p))
                .filter(|q| q.distance(pe) <= portata)
                .min_by(|a, b| a.distance(pe).total_cmp(&b.distance(pe)))
        });
        if let Some(q) = ancora {
            return q;
        }
        if let Some(c) = doc.bounds_of(&[id], false).map(|r| r.center()) {
            if c.distance(pe) <= portata {
                return c;
            }
        }
    }
    pe
}

/// Il gesto che comincia la pressione del contesto, e la pressione.
fn analizza(cx: &Contesto<'_>) -> Option<(Gesto, DrawingPointer)> {
    let press = cx.pressione?;
    let p = punto(&press);
    let pe = al_motore(cx, p);
    let s = cx.gesto.zoom;
    let doc = &cx.copia.documento;
    let mappa = &cx.copia.mappa;
    let sel = scelti(cx);
    let sel_nodi = nodi(cx, &sel);
    let vz = cx.vista.zoom;
    let radice = cx.copia.radice;
    let [ra, rb, rc, rd, _, _] = radice.as_coeffs();

    if let Some(c) = cornice(cx, &sel) {
        match maniglia(&c, p, s) {
            Some(Maniglia::Lato(gx, gy)) => {
                let proporzioni = sel.iter().any(|i| {
                    elemento(cx, *i).is_some_and(|e| {
                        matches!(
                            e.ruolo,
                            Role::Group | Role::Link | Role::Stroke | Role::Text | Role::Image
                        )
                    })
                });
                let motore = (|| {
                    // La cornice del motore deve essere quella di Fub: dritta,
                    // senza contorno, la stessa nel documento del motore.
                    if !dritta(c.m)
                        || rb != 0.0
                        || rc != 0.0
                        || !rett_vicini(c.scatola, c.geometria)
                    {
                        return None;
                    }
                    let bx = doc.oriented_bounds(&sel_nodi, false)?;
                    if bx.angle != 0.0 {
                        return None;
                    }
                    let mia = radice.transform_rect_bbox(c.m.transform_rect_bbox(c.geometria));
                    if !rett_vicini(mia, bx.rect) {
                        return None;
                    }
                    let [a, _, _, d, _, _] = c.m.as_coeffs();
                    let vx = i8::try_from(gx as i32 * (a * ra).signum() as i32).ok()?;
                    let vy = i8::try_from(gy as i32 * (d * rd).signum() as i32).ok()?;
                    let h = match (vx, vy) {
                        (-1, -1) => Handle::TopLeft,
                        (0, -1) => Handle::Top,
                        (1, -1) => Handle::TopRight,
                        (1, 0) => Handle::Right,
                        (1, 1) => Handle::BottomRight,
                        (0, 1) => Handle::Bottom,
                        (-1, 1) => Handle::BottomLeft,
                        (-1, 0) => Handle::Left,
                        _ => return None,
                    };
                    let hp = h.pos(bx.rect);
                    // Il motore deve prendere proprio quella maniglia, e non un
                    // cursore della torta.
                    if hit_handle(bx.rect, hp, MOTORE_MANIGLIA_PX / vz) != Some(h) {
                        return None;
                    }
                    let mut s = Selection::default();
                    sel_nodi.iter().for_each(|n| s.add(*n));
                    let torta = PieWidget::of(doc, &s, vz)
                        .iter()
                        .any(|w| w.at.distance(hp) <= MOTORE_MANIGLIA_PX / vz);
                    (!torta).then_some((bx.rect, h))
                })();
                return Some((
                    Gesto::Ridimensiona {
                        cornice: c,
                        lato: (gx, gy),
                        proporzioni,
                        motore,
                    },
                    press,
                ));
            }
            Some(Maniglia::Ruota) => {
                let perno = c.m * c.scatola.center();
                let motore = (|| {
                    // Una similitudine senza riflessione tiene gli angoli.
                    if !(vicini(ra, rd) && vicini(rb, -rc) && radice.determinant() > 0.0) {
                        return None;
                    }
                    let centro = doc.oriented_bounds(&sel_nodi, false)?.center();
                    let mio = alla_scena(cx, centro);
                    if !(vicini(mio.x, perno.x) && vicini(mio.y, perno.y)) {
                        return None;
                    }
                    let verso = pe - centro;
                    let lunga = verso.hypot();
                    if lunga <= 0.0 || !lunga.is_finite() {
                        return None;
                    }
                    let leva = lunga.max(MOTORE_LEVA_PX / vz);
                    Some((centro + verso * (leva / lunga), centro))
                })();
                return Some((
                    Gesto::Ruota {
                        cornice: c,
                        perno,
                        motore,
                    },
                    press,
                ));
            }
            None => {}
        }
    }

    // Un oggetto sotto il puntatore, o il vuoto.
    let colpo = hit_test(doc, pe, opzioni(cx));
    let colpito = colpo.as_ref().and_then(|h| {
        let top = h.top_object(None);
        let i = mappa.del_nodo(top)?;
        let e = mappa.elemento(i)?;
        (!matches!(e.ruolo, Role::Paper | Role::Layer)).then_some((i, top, h))
    });
    let Some((mut i, top, h)) = colpito else {
        // La carta o un oggetto che Fub non conosce si comportano come il
        // vuoto; il motore lo sceglierebbe: il riquadro lo fa Fub.
        let base = if press.shift { sel.clone() } else { Vec::new() };
        let motore = colpo.is_none() && !maniglia_del_motore(cx, &sel_nodi, pe);
        return Some((Gesto::Riquadro { base, motore }, press));
    };
    // Sopra un oggetto scelto dentro un gruppo il gesto prende lui.
    let mut dentro = false;
    if !sel.contains(&i) {
        let dentro_di = |u: &usize| {
            elemento(cx, *u)
                .and_then(|e| e.nodo)
                .is_some_and(|n| n != top && (n == h.leaf || h.ancestry.contains(&n)))
        };
        if let Some(u) = sel.iter().find(|u| dentro_di(u)) {
            i = *u;
            dentro = true;
        }
    }
    let scelto = sel.contains(&i);
    let mut lascia = None;
    let dopo = if press.shift {
        if scelto {
            lascia = Some(i);
            sel.clone()
        } else {
            let percorso = elemento(cx, i)
                .map(|e| e.percorso.clone())
                .unwrap_or_default();
            // In ordine di documento, poi quello aggiunto (`selectStart`).
            let mut d: Vec<usize> = in_ordine(cx, sel.iter().copied())
                .into_iter()
                .filter(|u| !elemento(cx, *u).is_some_and(|e| contiene(&e.percorso, &percorso)))
                .collect();
            d.push(i);
            d
        }
    } else if scelto {
        sel.clone()
    } else {
        vec![i]
    };
    // L'angolo della geometria più vicino alla pressione (`nearestCorner`).
    let indietro = radice.inverse();
    let simboli = doc.symbol_boxes();
    let geometria = nodi(cx, &dopo).iter().fold(None, |acc, n| {
        let Some(n) = doc.node(*n) else { return acc };
        unione(
            acc,
            n.bounds_in(&simboli, indietro, false)
                .or_else(|| n.bounds_in(&simboli, indietro, true)),
        )
    });
    let fonte = geometria.map(|g: Rect| {
        let x = if (p.x - g.x0).abs() <= (p.x - g.x1).abs() {
            g.x0
        } else {
            g.x1
        };
        let y = if (p.y - g.y0).abs() <= (p.y - g.y1).abs() {
            g.y0
        } else {
            g.y1
        };
        Point::new(x, y)
    });
    let motore = (|| {
        if dentro {
            return None;
        }
        // Il motore comincia con la selezione di dopo la pressione
        // (`Selezione::prepara`): la pressione gli arriva dove lui prende
        // l'oggetto, e lì deve prendere lo stesso oggetto e nessuna maniglia
        // sua.
        let sua = nodi(cx, &dopo);
        let g = presa_del_motore(cx, &sua, pe);
        let stesso = hit_test(doc, g, opzioni(cx)).map(|h| h.top_object(None)) == Some(top);
        (stesso && !maniglia_del_motore(cx, &sua, g)).then_some(g)
    })();
    Some((
        Gesto::Sposta {
            dopo,
            lascia,
            fonte,
            motore,
        },
        press,
    ))
}

/// Vero se il puntatore è andato oltre la soglia del trascinamento.
fn trascinato(cx: &Contesto<'_>, press: &DrawingPointer, e: &DrawingPointer) -> bool {
    (e.x - press.x).hypot(e.y - press.y) * cx.gesto.zoom > DRAG_PX
}

/// Ctrl/⌘ scioglie la griglia e la calamita.
fn libero(cx: &Contesto<'_>, e: &DrawingPointer) -> bool {
    cx.gesto.snap.free || e.cmd
}

/// `snappedDelta`: lo spostamento di (`dx`, `dy`) di ciò che si prende in
/// `fonte`.
fn spostamento(
    cx: &Contesto<'_>,
    e: &DrawingPointer,
    dx: f64,
    dy: f64,
    fonte: Option<Point>,
) -> Vec2 {
    match (cx.gesto.snap.grid.filter(|_| !libero(cx, e)), fonte) {
        (Some(passo), Some(f)) => {
            let x = sulla_riga(f.x + dx, passo);
            let y = sulla_riga(f.y + dy, passo);
            Vec2::new(pulito(x - f.x), pulito(y - f.y))
        }
        _ => Vec2::new(due_decimali(dx), due_decimali(dy)),
    }
}

/// `resized`: il riquadro `scatola` dopo aver tirato il lato `lato` di
/// `delta`, nelle unità della cornice. `griglia` è `gridSnap` della cornice.
#[allow(clippy::too_many_arguments)]
fn ridimensionato(
    scatola: Rect,
    lato: (i8, i8),
    delta: Vec2,
    proporzioni: bool,
    dal_centro: bool,
    minimo: [f64; 2],
    griglia: Option<(Affine, f64)>,
) -> Rect {
    let pull = [f64::from(lato.0), f64::from(lato.1)];
    let d = [delta.x, delta.y];
    let centro = [scatola.center().x, scatola.center().y];
    let mut fermo = [0.0; 2];
    let mut bordo = [0.0; 2];
    let mut fattore = [1.0; 2];
    let mut pavimento = [0.0; 2];
    let mut vivi: Vec<usize> = Vec::new();
    // La griglia vista dalla cornice: `near` e `beyond`.
    let vicina = |asse: usize, v: f64| {
        griglia.map(|(m, passo)| {
            let c = m.as_coeffs();
            let (s, o) = if asse == 0 {
                (c[0], c[4])
            } else {
                (c[3], c[5])
            };
            (sulla_riga(s * v + o, passo) - o) / s
        })
    };
    let oltre = |asse: usize, v: f64, verso: f64| {
        griglia.map(|(m, passo)| {
            let c = m.as_coeffs();
            let (s, o) = if asse == 0 {
                (c[0], c[4])
            } else {
                (c[3], c[5])
            };
            let v2 = if s > 0.0 { verso } else { -verso };
            (riga_oltre(s * v + o, passo, v2) - o) / s
        })
    };
    for asse in 0..2 {
        let verso = pull[asse];
        let misura = hi(scatola, asse) - lo(scatola, asse);
        fermo[asse] = if dal_centro {
            centro[asse]
        } else if verso > 0.0 {
            lo(scatola, asse)
        } else {
            hi(scatola, asse)
        };
        bordo[asse] = if verso > 0.0 {
            hi(scatola, asse)
        } else {
            lo(scatola, asse)
        };
        if verso == 0.0 || misura.is_nan() || misura <= 0.0 {
            continue;
        }
        vivi.push(asse);
        pavimento[asse] = (minimo[asse] / misura).min(1.0);
        let puntato = bordo[asse] + d[asse];
        let mut riga = vicina(asse, puntato);
        if let Some(r) = riga {
            if (r - fermo[asse]) * verso <= 0.0 {
                riga = oltre(asse, fermo[asse], verso);
            }
        }
        fattore[asse] = (riga.unwrap_or(puntato) - fermo[asse]) / (bordo[asse] - fermo[asse]);
    }
    if proporzioni && vivi.len() == 2 {
        let ux = bordo[0] - fermo[0];
        let uy = bordo[1] - fermo[1];
        let mut f = ((bordo[0] + d[0] - fermo[0]) * ux + (bordo[1] + d[1] - fermo[1]) * uy)
            / (ux * ux + uy * uy);
        if griglia.is_some() {
            let asse = if scatola.width() >= scatola.height() {
                0
            } else {
                1
            };
            let verso = pull[asse];
            let at = fermo[asse] + f * (bordo[asse] - fermo[asse]);
            let mut bersaglio = vicina(asse, at).unwrap_or(at);
            if (bersaglio - fermo[asse]) * verso <= 0.0 {
                bersaglio = oltre(asse, fermo[asse], verso).unwrap_or(bersaglio);
            }
            f = (bersaglio - fermo[asse]) / (bordo[asse] - fermo[asse]);
        }
        let f = f.max(pavimento[0]).max(pavimento[1]);
        fattore = [f, f];
    } else {
        for asse in vivi {
            fattore[asse] = fattore[asse].max(pavimento[asse]);
        }
    }
    let lato_di = |asse: usize, v: f64| fermo[asse] + fattore[asse] * (v - fermo[asse]);
    Rect::new(
        lato_di(0, scatola.x0),
        lato_di(1, scatola.y0),
        lato_di(0, scatola.x1),
        lato_di(1, scatola.y1),
    )
}

/// `boxMatrix`: la scala e la traslazione da `da` ad `a`.
fn matrice_fra(da: Rect, a: Rect) -> Affine {
    let sx = if da.width() > 0.0 {
        a.width() / da.width()
    } else {
        1.0
    };
    let sy = if da.height() > 0.0 {
        a.height() / da.height()
    } else {
        1.0
    };
    Affine::new([sx, 0.0, 0.0, sy, a.x0 - sx * da.x0, a.y0 - sy * da.y0])
}

/// `rotation`: i gradi di cui ruotare attorno a `perno` perché `da` vada
/// verso `a`, con la cornice già girata di `base`.
fn rotazione(
    perno: Point,
    da: Point,
    a: Point,
    base: f64,
    passo: Option<f64>,
    calamita: f64,
) -> f64 {
    if da == perno || a == perno {
        return 0.0;
    }
    let ra = (da.y - perno.y).atan2(da.x - perno.x);
    let rb = (a.y - perno.y).atan2(a.x - perno.x);
    let angolo = normalizzato(base + (rb - ra).to_degrees());
    let meta = match passo.filter(|p| *p > 0.0) {
        Some(p) => round_js(angolo / p) * p,
        None => {
            let retto = round_js(angolo / 90.0) * 90.0;
            if (angolo - retto).abs() <= calamita {
                retto
            } else {
                round_js(angolo * 10.0) / 10.0
            }
        }
    };
    normalizzato(meta - base)
}

fn intorno(perno: Point, a: Affine) -> Affine {
    Affine::translate(perno.to_vec2()) * a * Affine::translate(-perno.to_vec2())
}

/// La matrice di Fub del gesto al punto `e`, nella scena; `None` finché il
/// puntatore non ha passato la soglia o se non c'è niente da trasformare.
fn matrice(
    cx: &Contesto<'_>,
    gesto: &Gesto,
    press: &DrawingPointer,
    e: &DrawingPointer,
) -> Option<Affine> {
    if !trascinato(cx, press, e) {
        return None;
    }
    match gesto {
        Gesto::Sposta { fonte, .. } => {
            let d = spostamento(cx, e, e.x - press.x, e.y - press.y, *fonte);
            Some(Affine::translate(d))
        }
        Gesto::Riquadro { .. } => None,
        Gesto::Ridimensiona {
            cornice: c,
            lato,
            proporzioni,
            ..
        } => {
            let inversa = c.m.inverse();
            if !inversa.is_finite() {
                return None;
            }
            let [a, b, cc, d, _, _] = inversa.as_coeffs();
            let (dx, dy) = (due_decimali(e.x - press.x), due_decimali(e.y - press.y));
            let delta = Vec2::new(a * dx + cc * dy, b * dx + d * dy);
            let mc = c.m.as_coeffs();
            let griglia = cx
                .gesto
                .snap
                .grid
                .filter(|_| !libero(cx, e))
                .filter(|_| dritta(c.m) && mc[0] != 0.0 && mc[3] != 0.0)
                .map(|passo| (c.m, passo));
            let lavoro = if griglia.is_some() {
                c.geometria
            } else {
                c.scatola
            };
            let (lx, ly) = assi(c.m);
            let angolo = lato.0 != 0 && lato.1 != 0;
            let nuova = ridimensionato(
                lavoro,
                *lato,
                delta,
                angolo && (*proporzioni != e.shift),
                e.alt,
                [MIN_SIZE / lx, MIN_SIZE / ly],
                griglia,
            );
            Some(c.m * matrice_fra(lavoro, nuova) * inversa)
        }
        Gesto::Ruota {
            cornice: c, perno, ..
        } => {
            let [a, b, _, _, _, _] = c.m.as_coeffs();
            let base = normalizzato(b.atan2(a).to_degrees());
            let gradi = rotazione(
                *perno,
                punto(press),
                punto(e),
                base,
                e.shift.then_some(ROTATE_STEP),
                if libero(cx, e) { 0.0 } else { MAGNET_DEGREES },
            );
            Some(intorno(*perno, Affine::rotate(gradi.to_radians())))
        }
    }
}

/// Gli oggetti che il gesto trasforma.
fn trasformati(cx: &Contesto<'_>, gesto: &Gesto) -> Vec<usize> {
    match gesto {
        Gesto::Sposta { dopo, .. } => dopo.clone(),
        _ => scelti(cx),
    }
}

/// Il riquadro di selezione da `da` ad `a`, nella scena.
fn riquadro(da: Point, a: Point) -> Rect {
    Rect::from_points(da, a)
}

/// La selezione del riquadro da `da` ad `a` (`marqueed`): `base` e gli
/// oggetti dentro per intero, in ordine di documento.
fn scelti_dal_riquadro(cx: &Contesto<'_>, base: &[usize], da: Point, a: Point) -> Vec<usize> {
    let mut tutti = base.to_vec();
    if da != a {
        let r = riquadro(da, a);
        let doc = &cx.copia.documento;
        let simboli = doc.symbol_boxes();
        let indietro = cx.copia.radice.inverse();
        let re = cx.copia.radice.transform_rect_bbox(r);
        for n in marquee(doc, re, None, false) {
            let Some(i) = cx.copia.mappa.del_nodo(n) else {
                continue;
            };
            if elemento(cx, i).is_some_and(|e| matches!(e.ruolo, Role::Paper | Role::Layer)) {
                continue;
            }
            let dentro = doc
                .node(n)
                .and_then(|n| n.bounds_in(&simboli, indietro, true))
                .is_some_and(|b| r.x0 <= b.x0 && b.x1 <= r.x1 && r.y0 <= b.y0 && b.y1 <= r.y1);
            if dentro {
                tutti.push(i);
            }
        }
    }
    in_ordine(cx, tutti)
}

/// Le operazioni che portano gli oggetti `indici` della copia dove li
/// mette `m` (nella scena).
fn applica(
    cx: &Contesto<'_>,
    indici: &[usize],
    m: Affine,
) -> Result<Option<String>, DrawingRefusal> {
    let copia = cx.copia;
    let me = copia.radice * m * copia.radice.inverse();
    if !me.is_finite() {
        return Err(DrawingRefusal::Unsupported);
    }
    let lista = nodi(cx, indici);
    vectorcraft_engine::guard::catch_panic(|| {
        let mut dopo = (*copia.documento).clone();
        for n in &lista {
            if let Some(nodo) = dopo.node_mut(*n) {
                nodo.transform(me, Scaling::from(true));
            }
        }
        differenza::differenza(copia, &dopo, None).and_then(|d| d.testo())
    })
    .map_err(|_| DrawingRefusal::Unsupported)?
    .map_err(|r| r.rifiuto())
}

impl Strumento for Selezione {
    fn id_motore(&self) -> &'static str {
        "selection"
    }

    fn prepara(&self, sessione: &mut Session, cx: &Contesto<'_>) -> Result<(), DrawingRefusal> {
        // Le preferenze che le regole qui sopra danno per scontate (la sessione
        // è di tutti gli strumenti: le forme ne cambiano alcune).
        let prefs = &mut sessione.prefs;
        prefs.snapping_tolerance = 0.0;
        prefs.snap_to_point_tolerance = 0.0;
        prefs.construction_guides = false;
        prefs.distance_guides = false;
        prefs.use_preview_bounds = false;
        prefs.scale_strokes = true;
        prefs.scale_corners = true;
        prefs.hide_corner_widget_above = -1.0;
        prefs.selection_tolerance = HIT_PX;
        prefs.object_selection_by_path_only = false;
        prefs.type_selection_by_path_only = false;
        prefs.ctrl_click_selects_behind = false;
        prefs.double_click_to_isolate = false;
        // Il motore comincia con la selezione che la regola di Fub dà alla
        // pressione: spostare con Maiusc non passa dalla sua (che con Maiusc
        // toglierebbe l'oggetto già scelto).
        let gesto = analizza(cx).map(|(g, _)| g);
        let lista = match &gesto {
            Some(Gesto::Sposta { dopo, .. }) => nodi(cx, dopo),
            _ => nodi(cx, &scelti(cx)),
        };
        let stato = sessione
            .doc_mut()
            .map_err(|_| DrawingRefusal::Unsupported)?;
        stato.selection = Selection::default();
        lista.iter().for_each(|n| stato.selection.add(*n));
        stato.isolation = None;
        if let Some(Gesto::Ruota {
            motore: Some(_), ..
        }) = gesto
        {
            sessione
                .select_tool("rotate", cx.vista)
                .map_err(|_| DrawingRefusal::Unsupported)?;
        }
        Ok(())
    }

    fn evento(
        &self,
        e: DrawingPointer,
        _inizio: Option<&DrawingPointer>,
        cx: &Contesto<'_>,
    ) -> DrawingPointer {
        let qui = |kind, p: Point, shift: bool, alt: bool| DrawingPointer {
            kind,
            x: p.x,
            y: p.y,
            shift,
            alt,
            cmd: false,
            ..e
        };
        let passa = qui(DrawingPointerKind::Move, punto(&e), false, false);
        let tiene = matches!(
            e.kind,
            DrawingPointerKind::Down | DrawingPointerKind::Drag | DrawingPointerKind::Up
        );
        let Some((gesto, press)) = analizza(cx).filter(|_| tiene) else {
            return passa;
        };
        let giu = e.kind == DrawingPointerKind::Down;
        let m = if giu {
            None
        } else {
            matrice(cx, &gesto, &press, &e)
        };
        match &gesto {
            Gesto::Sposta {
                motore: Some(g), ..
            } => {
                let g = alla_scena(cx, *g);
                let p = m.map_or(g, |m| m * g);
                qui(e.kind, p, false, false)
            }
            Gesto::Riquadro { motore: true, .. } => qui(e.kind, punto(&e), false, false),
            Gesto::Ridimensiona {
                motore: Some((r, h)),
                ..
            } => {
                let hp = h.pos(*r);
                let p = match m {
                    Some(m) => {
                        let me = cx.copia.radice * m * cx.copia.radice.inverse();
                        let c = me.as_coeffs();
                        let o = if e.alt {
                            r.center()
                        } else {
                            h.opposite().pos(*r)
                        };
                        Point::new(o.x + c[0] * (hp.x - o.x), o.y + c[3] * (hp.y - o.y))
                    }
                    None => hp,
                };
                qui(e.kind, alla_scena(cx, p), false, e.alt && !giu)
            }
            Gesto::Ruota {
                motore: Some((q, c)),
                ..
            } => {
                let p = match m {
                    // La stessa rotazione attorno al centro del motore, che
                    // per costruzione è il perno di Fub.
                    Some(m) => {
                        let [a, b, _, _, _, _] = m.as_coeffs();
                        intorno(*c, Affine::rotate(b.atan2(a))) * *q
                    }
                    None => *q,
                };
                qui(e.kind, alla_scena(cx, p), false, false)
            }
            _ => passa,
        }
    }

    fn anteprima(&self, _sessione: &mut Session, cx: &Contesto<'_>) -> Option<DrawingPreview> {
        let (gesto, press) = analizza(cx)?;
        let e = cx.gesto.events.last()?;
        if let Gesto::Riquadro { .. } = gesto {
            let r = riquadro(punto(&press), punto(e));
            return Some(DrawingPreview {
                marquee: Some([r.x0, r.y0, r.width(), r.height()]),
                ..DrawingPreview::default()
            });
        }
        let m = matrice(cx, &gesto, &press, e)?;
        Some(DrawingPreview {
            matrix: Some(m.as_coeffs()),
            ..DrawingPreview::default()
        })
    }

    fn rifinisci(&self, esito: &mut DrawingOutcome, cx: &Contesto<'_>) {
        if esito.refused.is_some() {
            return;
        }
        if let Some((gesto, press)) = analizza(cx) {
            let fine = cx
                .gesto
                .events
                .iter()
                .rev()
                .find(|e| {
                    matches!(
                        e.kind,
                        DrawingPointerKind::Down
                            | DrawingPointerKind::Drag
                            | DrawingPointerKind::Up
                    )
                })
                .copied()
                .unwrap_or(press);
            let di_fub = matches!(
                gesto,
                Gesto::Sposta { motore: None, .. }
                    | Gesto::Ridimensiona { motore: None, .. }
                    | Gesto::Ruota { motore: None, .. }
            );
            if let Gesto::Riquadro { base, .. } = &gesto {
                let dopo = scelti_dal_riquadro(cx, base, punto(&press), punto(&fine));
                esito.selection = ids_di(cx, &dopo, None);
            } else {
                let mut indici = trasformati(cx, &gesto);
                let m = matrice(cx, &gesto, &press, &fine);
                if let (true, Some(m)) = (di_fub, m) {
                    match applica(cx, &indici, m) {
                        Ok(testo) => esito.ops = testo,
                        Err(r) => {
                            // Come ogni rifiuto: niente operazioni, niente
                            // selezione.
                            esito.ops = None;
                            esito.selection = Vec::new();
                            esito.refused = Some(r);
                            return;
                        }
                    }
                }
                // La selezione la decide la regola di Fub anche quando il
                // gesto l'ha fatto il motore: un clic senza trascinare con
                // Maiusc su un oggetto scelto lo lascia.
                if let (
                    None,
                    Gesto::Sposta {
                        lascia: Some(l), ..
                    },
                ) = (m, &gesto)
                {
                    indici.retain(|i| i != l);
                }
                esito.selection = ids_di(cx, &indici, esito.ops.as_deref());
            }
        }
        // Niente scritto e niente scelto di diverso: un gesto a vuoto.
        if esito.ops.is_none() && esito.selection == cx.gesto.selection {
            esito.refused = Some(DrawingRefusal::Empty);
        }
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn rotazione_come_il_client() {
        let perno = Point::new(150.0, 125.0);
        // La calamita porta 88,9° sull'angolo retto.
        let g = rotazione(
            perno,
            Point::new(150.0, 72.0),
            Point::new(203.0, 124.0),
            0.0,
            None,
            MAGNET_DEGREES,
        );
        assert_eq!(g, 90.0);
        // Senza calamita, al decimo di grado.
        let g = rotazione(
            perno,
            Point::new(150.0, 72.0),
            Point::new(203.0, 124.0),
            0.0,
            None,
            0.0,
        );
        assert_eq!(g, 88.9);
        // Con i passi, sull'angolo che la cornice avrà.
        let g = rotazione(
            perno,
            Point::new(150.0, 72.0),
            Point::new(168.0, 75.0),
            10.0,
            Some(15.0),
            MAGNET_DEGREES,
        );
        assert_eq!(g, 20.0);
        assert_eq!(normalizzato(-180.0), 180.0);
        assert_eq!(normalizzato(190.0), -170.0);
    }

    #[test]
    fn ridimensionare_come_il_client() {
        let b = Rect::new(100.0, 100.0, 200.0, 150.0);
        let r = ridimensionato(
            b,
            (1, 0),
            Vec2::new(50.0, 0.0),
            false,
            false,
            [1.0, 1.0],
            None,
        );
        assert_eq!((r.x0, r.x1), (100.0, 250.0));
        // Sotto la misura minima, e mai oltre il lato opposto.
        let r = ridimensionato(
            b,
            (1, 0),
            Vec2::new(-150.0, 0.0),
            false,
            false,
            [1.0, 1.0],
            None,
        );
        assert_eq!((r.x0, r.x1), (100.0, 101.0));
        // La griglia: il bordo sulla riga più vicina.
        let r = ridimensionato(
            b,
            (1, 0),
            Vec2::new(33.0, 0.0),
            false,
            false,
            [1.0, 1.0],
            Some((Affine::IDENTITY, 20.0)),
        );
        assert_eq!(r.x1, 240.0);
        // Le proporzioni dall'angolo.
        let r = ridimensionato(
            b,
            (1, 1),
            Vec2::new(50.0, 25.0),
            true,
            false,
            [1.0, 1.0],
            None,
        );
        assert_eq!((r.x1, r.y1), (250.0, 175.0));
        // Alt: fermo il centro.
        let r = ridimensionato(
            b,
            (1, 0),
            Vec2::new(20.0, 0.0),
            false,
            true,
            [1.0, 1.0],
            None,
        );
        assert_eq!((r.x0, r.x1), (80.0, 220.0));
    }

    #[test]
    fn righe_come_il_client() {
        assert_eq!(sulla_riga(233.0, 20.0), 240.0);
        assert_eq!(riga_oltre(100.0, 20.0, 1.0), 120.0);
        assert_eq!(riga_oltre(100.0, 20.0, -1.0), 80.0);
        assert_eq!(pulito(-0.001), 0.0);
    }
}
