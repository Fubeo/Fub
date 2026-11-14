//! Rettangolo, ellisse, linea e freccia con lo strumento forma del motore
//! (`ShapeTool` di `vendor/vectorcraft/crates/tools/src/shape.rs`: gli id
//! `rectangle`, `ellipse` e `lineSegment`). Il risultato è quello degli
//! strumenti TypeScript di oggi (`apps/client/src/editors/spatial/tools/shapes.ts`,
//! `tools/editor/selection-gestures.ts`), che i vettori dei gesti fissano.
//!
//! Chi fa che cosa:
//!
//! - **Gli eventi** ([`Strumento::evento`]) seguono le regole di Fub prima
//!   che li veda il motore: la griglia aggancia la pressione e ogni punto
//!   dopo (Ctrl/⌘ la scioglie, come `snapped` del client); Maiusc fa il
//!   quadrato o il cerchio, e per linea e freccia passi di 15°, nello spazio
//!   del livello (`constrainEnd`). Poi Maiusc, Alt e Ctrl/⌘ si tolgono:
//!   nel motore Maiusc vorrebbe passi di 45°, Alt disegnerebbe dal centro e
//!   Ctrl/⌘ presterebbe lo strumento di selezione.
//! - **La preparazione** ([`Strumento::prepara`]) sceglie il livello come
//!   l'editor (quello del gesto, se no il più alto visibile e non bloccato;
//!   nascosto è `hidden`, bloccato o nessun livello è `locked`), lo fa
//!   livello attivo del motore, e dà al motore lo stile del gesto (contorno,
//!   spessore nello spazio del livello, riempimento) e niente guide
//!   magnetiche sue: le tolleranze dell'aggancio a zero.
//! - **L'elemento** ([`Strumento::elemento`]) è quello di `shapeElem`: i due
//!   angoli arrotondati a due decimali prima di misurare, `fill="none"` su
//!   rettangolo ed ellisse senza riempimento, la linea con
//!   `stroke-linecap="round"`, la freccia come `path` con `fub:shape`,
//!   `fub:geom` e il `d` della punta calcolato dalla geometria arrotondata.
//! - **La misura minima** ([`Strumento::rifinisci`]): sotto
//!   [`MIN_SHAPE_PX`] pixel sullo schermo, o con un lato nullo dopo
//!   l'arrotondamento, nessuna forma: `empty`. Disegnare non cambia la
//!   selezione.
//! - **L'anteprima** ([`Strumento::anteprima`]) è l'`Elem` della forma
//!   provvisoria, con l'id `preview`, nello spazio del livello (il client la
//!   disegna con la matrice del livello).

use fub_abi::{
    DrawingOutcome, DrawingPointer, DrawingPointerKind, DrawingPreview, DrawingRefusal, DrawingTool,
};
use fub_scene::Role;
use serde_json::{json, Map, Value};
use vectorcraft_doc::color::{Color, Paint};
use vectorcraft_doc::{Node, NodeId, NodeKind};
use vectorcraft_engine::Session;
use vectorcraft_geom::{Affine, Point};
use vectorcraft_tools::PaintDefaults;

use super::{Contesto, Strumento};
use crate::differenza::numero;
use crate::mappa::Posti;

/// La misura sotto cui una forma tirata è un tocco, in pixel dello schermo
/// (`MIN_SHAPE_PX` di `tools/editor/constants.ts`).
pub const MIN_SHAPE_PX: f64 = 4.0;

/// I passi di Maiusc per linea e freccia, in gradi (`SNAP_DEGREES`).
pub const SNAP_DEGREES: f64 = 15.0;

/// L'angolo fra ogni lato della punta della freccia e l'asta, in gradi.
const HEAD_DEGREES: f64 = 30.0;

/// L'id dell'anteprima, come lo scrive il client.
const ID_ANTEPRIMA: &str = "preview";

/// Uno strumento di forma di Fub.
pub(crate) struct Forma {
    tool: DrawingTool,
}

static RETTANGOLO: Forma = Forma {
    tool: DrawingTool::Rect,
};
static ELLISSE: Forma = Forma {
    tool: DrawingTool::Ellipse,
};
static LINEA: Forma = Forma {
    tool: DrawingTool::Line,
};
static FRECCIA: Forma = Forma {
    tool: DrawingTool::Arrow,
};

/// Lo strumento di forma di `tool`; la freccia è la linea con la punta.
/// Chiamata solo per `rect`, `ellipse`, `line` e `arrow`: un altro
/// strumento dà il rettangolo.
pub(crate) fn strumento(tool: DrawingTool) -> &'static dyn Strumento {
    match tool {
        DrawingTool::Ellipse => &ELLISSE,
        DrawingTool::Line => &LINEA,
        DrawingTool::Arrow => &FRECCIA,
        _ => &RETTANGOLO,
    }
}

/// Dove va la forma nuova.
struct Destinazione {
    /// Il livello del motore che la riceve; `None`: quello che il motore
    /// sceglie da sé.
    livello: Option<NodeId>,
    /// Dallo spazio del livello al documento del motore.
    al_motore: Affine,
    /// Dallo spazio del livello alle coordinate della scena.
    alla_scena: Affine,
}

/// La scala di una matrice (`scaleOf` del client).
fn scala(m: Affine) -> f64 {
    m.determinant().abs().sqrt()
}

/// Il livello del gesto, come `target` dell'editor: quello scelto, o il più
/// alto né nascosto né bloccato; senza livelli, la radice.
fn destinazione(cx: &Contesto<'_>) -> Result<Destinazione, DrawingRefusal> {
    let copia = cx.copia;
    let mut livelli: Vec<_> = copia
        .mappa
        .elementi()
        .iter()
        .filter(|e| e.ruolo == Role::Layer)
        .collect();
    livelli.sort_by(|a, b| a.percorso.cmp(&b.percorso));
    let scelto = match cx.gesto.layer.as_deref() {
        Some(id) => {
            // Un livello che non c'è più: non c'è dove disegnare.
            let e = livelli
                .iter()
                .find(|e| e.id.as_deref() == Some(id))
                .ok_or(DrawingRefusal::Locked)?;
            if e.nascosto {
                return Err(DrawingRefusal::Hidden);
            }
            if e.bloccato {
                return Err(DrawingRefusal::Locked);
            }
            Some(*e)
        }
        None if livelli.is_empty() => None,
        None => Some(
            *livelli
                .iter()
                .rev()
                .find(|e| !e.nascosto && !e.bloccato)
                .ok_or(DrawingRefusal::Locked)?,
        ),
    };
    let radice_inversa = copia.radice.inverse();
    match scelto {
        Some(e) => {
            let nodo = e.nodo.ok_or(DrawingRefusal::Unmapped)?;
            let al_motore = e.ctm().ok_or(DrawingRefusal::Unsupported)?;
            let alla_scena = radice_inversa * al_motore;
            if !al_motore.inverse().is_finite() || !alla_scena.inverse().is_finite() {
                return Err(DrawingRefusal::Unsupported);
            }
            Ok(Destinazione {
                livello: Some(nodo),
                al_motore,
                alla_scena,
            })
        }
        None => {
            // Senza livelli di Fub la radice è il livello che l'import crea.
            let livello = copia
                .documento
                .layers
                .iter()
                .map(|l| l.id)
                .find(|id| copia.mappa.e_radice(*id));
            Ok(Destinazione {
                livello,
                al_motore: copia.radice,
                alla_scena: Affine::IDENTITY,
            })
        }
    }
}

/// La misura minima nello spazio del livello (`minimumFor`).
fn minimo(cx: &Contesto<'_>, dest: &Destinazione) -> f64 {
    let s = cx.gesto.zoom * scala(dest.alla_scena);
    if s > 0.0 && s.is_finite() {
        MIN_SHAPE_PX / s
    } else {
        0.0
    }
}

/// `Math.round` di JavaScript: la metà va verso +∞.
fn round_js(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// Un valore sulla griglia di passo `passo` (`snapValue`).
fn sulla_griglia(v: f64, passo: f64) -> f64 {
    let s = round_js(v / passo) * passo;
    let pulito = round_js(s * 100.0) / 100.0;
    if pulito == 0.0 {
        0.0
    } else {
        pulito
    }
}

/// La fine del trascinamento con Maiusc (`constrainEnd`): il quadrato o il
/// cerchio per rettangolo ed ellisse, un multiplo di 15° per linea e freccia.
pub(crate) fn vincola(tool: DrawingTool, da: Point, a: Point) -> Point {
    let (dx, dy) = (a.x - da.x, a.y - da.y);
    if matches!(tool, DrawingTool::Rect | DrawingTool::Ellipse) {
        let lato = dx.abs().max(dy.abs());
        let segno = |d: f64| if d < 0.0 { -lato } else { lato };
        return Point::new(da.x + segno(dx), da.y + segno(dy));
    }
    let lunghezza = dx.hypot(dy);
    if lunghezza == 0.0 {
        return a;
    }
    let passo = SNAP_DEGREES.to_radians();
    let angolo = round_js(dy.atan2(dx) / passo) * passo;
    Point::new(
        da.x + lunghezza * angolo.cos(),
        da.y + lunghezza * angolo.sin(),
    )
}

/// Un valore della geometria come lo scrive il file.
fn r2(v: f64) -> f64 {
    numero(v, 2).parse().unwrap_or(0.0)
}

fn t2(v: f64) -> String {
    numero(v, 2)
}

/// Il `d` di una freccia (`arrowPath`): l'asta e la punta aperta, lunga
/// 3 × lo spessore + 6, con i lati a 30° dall'asta.
pub(crate) fn d_della_freccia(x1: f64, y1: f64, x2: f64, y2: f64, spessore: f64) -> String {
    let punta = 3.0 * spessore + 6.0;
    let angolo = (y2 - y1).atan2(x2 - x1);
    let lato = HEAD_DEGREES.to_radians();
    let sinistra = (
        x2 - punta * (angolo - lato).cos(),
        y2 - punta * (angolo - lato).sin(),
    );
    let destra = (
        x2 - punta * (angolo + lato).cos(),
        y2 - punta * (angolo + lato).sin(),
    );
    format!(
        "M{} {} L{} {} M{} {} L{} {} L{} {}",
        t2(x1),
        t2(y1),
        t2(x2),
        t2(y2),
        t2(sinistra.0),
        t2(sinistra.1),
        t2(x2),
        t2(y2),
        t2(destra.0),
        t2(destra.1)
    )
}

fn colore(p: &Paint) -> Option<String> {
    match p {
        Paint::None => Some("none".into()),
        Paint::Solid { color, .. } => Some(color.to_hex()),
        _ => None,
    }
}

/// La misura di un `Elem` di forma per la regola della misura minima (il
/// lato più lungo, la lunghezza della linea); `None` se la forma non si
/// disegnerebbe (un lato nullo, una linea lunga zero).
fn misura(tag: &str, attrs: &Map<String, Value>) -> Option<f64> {
    let n = |k: &str| attrs.get(k)?.as_str()?.parse::<f64>().ok();
    match tag {
        "rect" => {
            let (w, h) = (n("width")?, n("height")?);
            (w > 0.0 && h > 0.0).then_some(w.max(h))
        }
        "ellipse" => {
            let (rx, ry) = (n("rx")?, n("ry")?);
            (rx > 0.0 && ry > 0.0).then_some(2.0 * rx.max(ry))
        }
        "line" => {
            let l = (n("x2")? - n("x1")?).hypot(n("y2")? - n("y1")?);
            (l > 0.0).then_some(l)
        }
        "path" => {
            let g: Vec<f64> = attrs
                .get("fub:geom")?
                .as_str()?
                .split_whitespace()
                .map(str::parse)
                .collect::<Result<_, _>>()
                .ok()?;
            let [x1, y1, x2, y2] = g[..] else { return None };
            let l = (x2 - x1).hypot(y2 - y1);
            (l > 0.0).then_some(l)
        }
        _ => None,
    }
}

/// Il primo `add` di un elenco di operazioni (anche dentro un `batch`).
fn primo_add(ops: &Value) -> Option<&Value> {
    match ops {
        Value::Array(a) => a.iter().find_map(primo_add),
        Value::Object(o) => match o.get("op").and_then(Value::as_str) {
            Some("add") => Some(ops),
            Some("batch") => o.get("ops").and_then(primo_add),
            _ => None,
        },
        _ => None,
    }
}

impl Forma {
    /// L'`Elem` di `nodo` portato nello spazio del livello da `locale`, come
    /// `shapeElem` lo scrive, senza `id`; anche con un lato nullo (la regola
    /// della misura la applica [`misura`]). `None` se il nodo non è la forma
    /// che lo strumento fa (allora lo scrive la differenza).
    fn scrivi(&self, nodo: &Node, locale: Affine) -> Option<(String, Map<String, Value>)> {
        let NodeKind::Path { path, .. } = &nodo.kind else {
            return None;
        };
        let [sotto] = &path.subpaths[..] else {
            return None;
        };
        let punti: Vec<Point> = sotto.anchors.iter().map(|a| locale * a.p).collect();
        let tratto = nodo
            .appearance
            .stroke()
            .filter(|s| !matches!(s.paint, Paint::None))?;
        let stroke = colore(&tratto.paint)?;
        let spessore = tratto.width * scala(locale);
        let mut attrs = Map::new();
        let tag = match self.tool {
            DrawingTool::Rect | DrawingTool::Ellipse => {
                if !sotto.closed || punti.len() != 4 {
                    return None;
                }
                let x0 = punti.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
                let x1 = punti.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
                let y0 = punti.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
                let y1 = punti.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
                let vicino = |a: f64, b: f64| (a - b).abs() <= 1e-6 * (1.0 + a.abs().max(b.abs()));
                let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
                // Dritta nello spazio del livello: gli angoli del rettangolo,
                // i quattro estremi dell'ellisse.
                let dritta = punti.iter().all(|p| match self.tool {
                    DrawingTool::Rect => {
                        (vicino(p.x, x0) || vicino(p.x, x1)) && (vicino(p.y, y0) || vicino(p.y, y1))
                    }
                    _ => {
                        ((vicino(p.x, x0) || vicino(p.x, x1)) && vicino(p.y, cy))
                            || ((vicino(p.y, y0) || vicino(p.y, y1)) && vicino(p.x, cx))
                    }
                });
                if !dritta {
                    return None;
                }
                let (x0, y0, x1, y1) = (r2(x0), r2(y0), r2(x1), r2(y1));
                let fill = nodo
                    .appearance
                    .fill()
                    .map_or(Some("none".into()), |f| colore(&f.paint))?;
                if self.tool == DrawingTool::Rect {
                    attrs.insert("x".into(), json!(t2(x0)));
                    attrs.insert("y".into(), json!(t2(y0)));
                    attrs.insert("width".into(), json!(t2(r2(x1 - x0))));
                    attrs.insert("height".into(), json!(t2(r2(y1 - y0))));
                    attrs.insert("fill".into(), json!(fill));
                    "rect"
                } else {
                    attrs.insert("cx".into(), json!(t2((x0 + x1) / 2.0)));
                    attrs.insert("cy".into(), json!(t2((y0 + y1) / 2.0)));
                    attrs.insert("rx".into(), json!(t2(r2((x1 - x0) / 2.0))));
                    attrs.insert("ry".into(), json!(t2(r2((y1 - y0) / 2.0))));
                    attrs.insert("fill".into(), json!(fill));
                    "ellipse"
                }
            }
            DrawingTool::Line | DrawingTool::Arrow => {
                let [a, b] = punti[..] else { return None };
                if sotto.closed {
                    return None;
                }
                let (x1, y1, x2, y2) = (r2(a.x), r2(a.y), r2(b.x), r2(b.y));
                if self.tool == DrawingTool::Line {
                    attrs.insert("x1".into(), json!(t2(x1)));
                    attrs.insert("y1".into(), json!(t2(y1)));
                    attrs.insert("x2".into(), json!(t2(x2)));
                    attrs.insert("y2".into(), json!(t2(y2)));
                    attrs.insert("stroke-linecap".into(), json!("round"));
                    "line"
                } else {
                    let geom = [x1, y1, x2, y2].map(t2).join(" ");
                    attrs.insert("fub:shape".into(), json!("arrow"));
                    attrs.insert("fub:geom".into(), json!(geom));
                    attrs.insert("d".into(), json!(d_della_freccia(x1, y1, x2, y2, spessore)));
                    attrs.insert("fill".into(), json!("none"));
                    attrs.insert("stroke-linecap".into(), json!("round"));
                    attrs.insert("stroke-linejoin".into(), json!("round"));
                    "path"
                }
            }
            DrawingTool::Select | DrawingTool::Text => return None,
        };
        attrs.insert("stroke".into(), json!(stroke));
        attrs.insert("stroke-width".into(), json!(t2(spessore)));
        Some((tag.to_string(), attrs))
    }
}

impl Strumento for Forma {
    fn id_motore(&self) -> &'static str {
        match self.tool {
            DrawingTool::Ellipse => "ellipse",
            DrawingTool::Line | DrawingTool::Arrow => "lineSegment",
            _ => "rectangle",
        }
    }

    fn prepara(&self, sessione: &mut Session, cx: &Contesto<'_>) -> Result<(), DrawingRefusal> {
        let stile = cx.gesto.style.as_ref().ok_or(DrawingRefusal::Unsupported)?;
        let dest = destinazione(cx)?;
        let pieno = |c: &str| {
            Color::from_hex(c)
                .map(Paint::solid)
                .ok_or(DrawingRefusal::Unsupported)
        };
        let stroke = pieno(&stile.stroke)?;
        let fill = match &stile.fill {
            Some(c) => pieno(c)?,
            None => Paint::None,
        };
        // Lo spessore è nello spazio del livello, come lo scrive il client.
        sessione.paint = PaintDefaults {
            fill,
            stroke,
            stroke_width: stile.width * scala(dest.al_motore),
            ..PaintDefaults::default()
        };
        // Niente guide magnetiche del motore: le forme di Fub si agganciano
        // solo alla griglia, che applica [`Strumento::evento`].
        sessione.prefs.snapping_tolerance = 0.0;
        sessione.prefs.snap_to_point_tolerance = 0.0;
        sessione.prefs.construction_guides = false;
        let stato = sessione
            .doc_mut()
            .map_err(|_| DrawingRefusal::Unsupported)?;
        stato.active_layer = dest.livello;
        stato.isolation = None;
        Ok(())
    }

    fn evento(
        &self,
        e: DrawingPointer,
        inizio: Option<&DrawingPointer>,
        cx: &Contesto<'_>,
    ) -> DrawingPointer {
        let snap = cx.gesto.snap;
        let mut p = Point::new(e.x, e.y);
        if let Some(passo) = snap.grid.filter(|_| !snap.free && !e.cmd) {
            p = Point::new(sulla_griglia(p.x, passo), sulla_griglia(p.y, passo));
        }
        if e.shift && matches!(e.kind, DrawingPointerKind::Drag | DrawingPointerKind::Up) {
            if let (Some(i), Ok(dest)) = (inizio, destinazione(cx)) {
                let indietro = dest.alla_scena.inverse();
                let da = indietro * Point::new(i.x, i.y);
                p = dest.alla_scena * vincola(self.tool, da, indietro * p);
            }
        }
        DrawingPointer {
            x: p.x,
            y: p.y,
            shift: false,
            alt: false,
            cmd: false,
            ..e
        }
    }

    fn anteprima(&self, sessione: &mut Session, cx: &Contesto<'_>) -> Option<DrawingPreview> {
        let dest = destinazione(cx).ok()?;
        let doc = sessione.doc().ok()?.doc.clone();
        let prima = Posti::di(&cx.copia.documento);
        let mut nuovo: Option<Node> = None;
        doc.walk(|n| {
            if nuovo.is_none()
                && matches!(n.kind, NodeKind::Path { .. })
                && !prima.nodi.contains_key(&n.id)
            {
                nuovo = Some(n.clone());
            }
        });
        let (tag, mut attrs) = self.scrivi(&nuovo?, dest.al_motore.inverse())?;
        if misura(&tag, &attrs).is_none_or(|m| m < minimo(cx, &dest)) {
            return None;
        }
        attrs.insert("id".into(), json!(ID_ANTEPRIMA));
        Some(DrawingPreview {
            shape: Some(json!({ "tag": tag, "attrs": attrs })),
            ..DrawingPreview::default()
        })
    }

    fn elemento(&self, nodo: &Node, locale: Affine) -> Option<(String, Map<String, Value>)> {
        self.scrivi(nodo, locale)
    }

    fn rifinisci(&self, esito: &mut DrawingOutcome, cx: &Contesto<'_>) {
        if esito.refused.is_some() {
            return;
        }
        // Disegnare non cambia la selezione.
        esito.selection = cx.gesto.selection.clone();
        let sotto = match (&esito.ops, destinazione(cx)) {
            (Some(testo), Ok(dest)) => {
                let ops: Value = serde_json::from_str(testo).unwrap_or(Value::Null);
                let elem = primo_add(&ops).map(|op| &op["elem"]);
                let misurata =
                    elem.and_then(|e| misura(e["tag"].as_str()?, e["attrs"].as_object()?));
                misurata.is_none_or(|m| m < minimo(cx, &dest))
            }
            _ => true,
        };
        if sotto {
            esito.ops = None;
            esito.refused = Some(DrawingRefusal::Empty);
        }
    }
}

#[cfg(test)]
mod prove {
    use super::*;

    #[test]
    fn maiusc_come_il_client() {
        let da = Point::new(40.0, 200.0);
        let p = vincola(DrawingTool::Line, da, Point::new(140.0, 164.0));
        assert_eq!((t2(p.x), t2(p.y)), ("142.66".into(), "172.49".into()));
        let q = vincola(
            DrawingTool::Rect,
            Point::new(40.0, 40.0),
            Point::new(140.0, 70.0),
        );
        assert_eq!((q.x, q.y), (140.0, 140.0));
        let indietro = vincola(
            DrawingTool::Ellipse,
            Point::new(40.0, 40.0),
            Point::new(0.0, 60.0),
        );
        assert_eq!((indietro.x, indietro.y), (0.0, 80.0));
        assert_eq!(vincola(DrawingTool::Line, da, da), da);
    }

    #[test]
    fn griglia_come_il_client() {
        assert_eq!(sulla_griglia(43.0, 20.0), 40.0);
        assert_eq!(sulla_griglia(-30.0, 20.0), -20.0);
        assert_eq!(sulla_griglia(-1.0, 20.0), 0.0);
        assert_eq!(sulla_griglia(0.5, 0.2), 0.6);
    }

    #[test]
    fn punta_della_freccia() {
        assert_eq!(
            d_della_freccia(40.0, 40.0, 160.0, 80.0, 4.0),
            "M40 40 L160 80 M142.37 83.61 L160 80 L148.06 66.53"
        );
    }

    #[test]
    fn misure() {
        let a = |v: Value| v.as_object().cloned().unwrap_or_default();
        assert_eq!(
            misura("rect", &a(json!({ "width": "2", "height": "0" }))),
            None
        );
        assert_eq!(
            misura("rect", &a(json!({ "width": "2", "height": "3" }))),
            Some(3.0)
        );
        assert_eq!(
            misura("path", &a(json!({ "fub:geom": "0 0 3 4" }))),
            Some(5.0)
        );
    }
}
