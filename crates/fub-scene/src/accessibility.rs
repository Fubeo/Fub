//! I controlli di §12 su come il disegno si legge: S009, il contrasto fra un
//! tratto a penna o un testo e ciò che ha sotto; S012, un'immagine senza
//! descrizione; S013, un testo troppo piccolo a grandezza naturale; S017, due
//! colori usati come codice che si distinguono soltanto per la tinta.
//!
//! [`Legibility`] segue la classificazione insieme al riepilogo, in ordine di
//! documento, che in SVG è l'ordine in cui si dipinge: ciò che sta sotto un
//! oggetto è dipinto prima di lui. Il fondo di un punto è la carta con sopra,
//! composte una dopo l'altra, le forme piene modificabili che lo coprono, con
//! le loro opacità. Un'immagine rende il fondo ignoto finché una forma opaca
//! non la copre, perché dei suoi pixel non si sa niente; così una forma il cui
//! colore non si sa. Come per la carta, il CSS e i blocchi estranei non
//! contano, e nemmeno i tratti a mano libera, che sono sottili.
//!
//! Dove si guarda:
//!
//! - **un testo**, una volta per riga: nel punto d'inizio del `tspan`, alzato
//!   di 0,35 volte la grandezza dei caratteri, a metà dell'occhio delle
//!   minuscole. Senza i caratteri la larghezza della riga non si sa, e
//!   l'inizio sta sempre sul testo, qualunque sia `text-anchor`. Un pezzo
//!   della riga con un colore, un corpo o un peso suoi si guarda nello stesso
//!   punto, col suo aspetto. Un testo su tracciato è una riga sola, e si
//!   guarda nel punto di `startOffset` sul tracciato, alzato allo stesso modo
//!   dalla parte dove stanno i caratteri;
//! - **un tratto a penna**, in sedici punti del contorno presi a distanze
//!   uguali fra i suoi vertici. Conta il contrasto mediano, quello che il
//!   tratto ha per gran parte della sua lunghezza: un tratto che attraversa
//!   un riquadro scuro non si legge male per questo.
//!
//! S017 guarda le stesse figure dipinte, quelle che coprono la carta, e dice
//! dove un disegno affida un significato al colore soltanto (WCAG 1.4.1, uso
//! del colore): due colori con meno di 3:1 fra loro (WCAG 1.4.11) non si
//! distinguono più per chi non vede la tinta, e non si capisce quale area va
//! con quale voce della legenda.
//!
//! - **le aree** sono le forme piene modificabili di cui il colore si sa,
//!   un colore semplice o un campione del documento, con un'opacità totale
//!   sopra 0. Non contano i tratti a penna e l'evidenziatore, che sono
//!   sottili, né i testi, le immagini, la carta, le tavole, i livelli e i
//!   gruppi in sé. Una sfumatura, un motivo (e quindi una campitura), un
//!   colore che decide una risorsa e ogni colore sotto `clip-path`, `mask` o
//!   `filter`, dell'elemento o di un contenitore, non si sanno, come per
//!   S009. Una figura il cui riquadro nella radice non ha larghezza o non ha
//!   altezza non è un'area, e una nascosta (`display="none"`, anche di un
//!   contenitore) non si guarda affatto;
//! - **il colore di un'area** è il suo colore con la sua opacità totale (il
//!   `fill-opacity` e le `opacity` dei gruppi, composte come per S009)
//!   composto sulla carta, o sul bianco senza carta, in sRGB e coi canali
//!   arrotondati a interi. Sulla carta soltanto, e non sulle figure sotto:
//!   il codice è il colore che l'autore ha scelto, non quello di ciò che
//!   per caso copre. Se la carta non si sa, un'area non opaca non ha colore
//!   che si sappia, come un fondo ignoto per S009;
//! - **i colori di codice** sono i colori composti che hanno almeno due
//!   aree: una fetta e la sua voce di legenda, due riquadri della stessa
//!   categoria. Un colore usato una volta è un ornamento, non un codice. Con
//!   più di 12 colori di codice S017 tace: è un'illustrazione o
//!   un'immagine ricalcata, non un codice;
//! - **una coppia confusa** è fatta di due colori di codice con un contrasto
//!   di WCAG sotto [`MIN_CONTRAST`] (3:1, la stessa soglia di S009 per un
//!   tratto);
//! - **una S017 per ogni colore di codice** che ha almeno un compagno
//!   confuso, sulla prima area del documento con quel colore. Il dettaglio è
//!   `#rrggbb #rrggbb r.rr`: il colore, il compagno col contrasto più basso
//!   (a parità, quello la cui prima area viene prima nel documento) e quel
//!   contrasto, troncato ai centesimi come per S009.

use std::cell::OnceCell;
use std::collections::HashMap;

use crate::analysis::{
    collapse, contrast, followed, len, over, radii, text_content, Context, DEFAULT_FONT_SIZE,
    LARGE_BOLD_TEXT, LARGE_TEXT, MIN_CONTRAST, MIN_TEXT_CONTRAST, MIN_TEXT_SIZE,
};
use crate::classify::{Role, Stroke, Tool};
use crate::diagnostics::{Code, Diagnostic};
use crate::geometry::{
    along, ellipse_path, flatten, parse_path, points_path, rect_path, winding, Bounds,
    BoundsBuilder, Matrix, Segment,
};
use crate::text::Span;
use crate::values::{points, start_offset, trim, Rgb};
use crate::xml::{Document, Element, Kind, NodeId, NS_NONE};

/// In quanti punti del contorno si misura un tratto a penna.
const STROKE_PROBES: usize = 16;

/// Quanto sopra la linea di base si guarda una riga, in grandezze dei
/// caratteri.
const LINE_PROBE: f64 = 0.35;

/// Con più colori di codice di così S017 tace: è un'illustrazione, non un
/// codice.
const MAX_CODES: usize = 12;

/// Una figura dipinta: dove sta e di che colore.
struct Painted {
    /// I segmenti nelle coordinate della figura, e la matrice verso la radice.
    segments: Vec<Segment>,
    matrix: Matrix,
    /// Il rettangolo che la contiene nella radice: un punto fuori non la
    /// tocca, e i poligoni non servono.
    bounds: Bounds,
    /// I poligoni nella radice, calcolati alla prima domanda.
    polygons: OnceCell<Vec<Vec<[f64; 2]>>>,
    /// Il colore con la sua opacità totale; `None` se non si sa, come per
    /// un'immagine.
    paint: Option<(Rgb, f64)>,
    /// L'elemento che ha dipinto la figura.
    span: Span,
}

impl Painted {
    /// Vero se la figura copre il punto `p` della radice.
    fn covers(&self, p: [f64; 2]) -> bool {
        let Bounds { min, max } = self.bounds;
        p[0] >= min[0]
            && p[0] <= max[0]
            && p[1] >= min[1]
            && p[1] <= max[1]
            && winding(
                self.polygons
                    .get_or_init(|| flatten(&self.segments, &self.matrix)),
                p,
            ) != 0
    }
}

/// Un colore composto sulla carta che hanno delle aree (S017).
struct Tint {
    color: Rgb,
    /// L'elemento della prima area con questo colore, in ordine di documento.
    first: Span,
    /// Quante aree hanno questo colore.
    areas: usize,
}

/// Una riga di testo da misurare.
struct Line {
    /// Il punto in cui si guarda, nella radice.
    at: [f64; 2],
    /// Il colore dei caratteri con la sua opacità; `None` se è `none` o non
    /// si sa, e allora la riga non si misura.
    color: Option<(Rgb, f64)>,
    /// Il contrasto che le basta: [`MIN_CONTRAST`] per un testo grande,
    /// [`MIN_TEXT_CONTRAST`] per gli altri.
    threshold: f64,
}

/// Ciò che si confronta col fondo.
enum Subject {
    /// Un tratto a penna: il colore e i punti del contorno nella radice.
    Pen {
        color: (Rgb, f64),
        probes: Vec<[f64; 2]>,
    },
    /// Un testo, riga per riga.
    Text { lines: Vec<Line> },
}

/// Un oggetto da confrontare col suo fondo alla fine, quando la carta si sa.
struct Check {
    span: Span,
    subject: Subject,
    /// Quante figure erano dipinte prima dell'oggetto: quelle che possono
    /// stargli sotto.
    under: usize,
}

/// I controlli su come il disegno si legge, durante la classificazione.
#[derive(Default)]
pub(crate) struct Legibility {
    painted: Vec<Painted>,
    checks: Vec<Check>,
    /// S012 e S013, che non dipendono dal fondo.
    found: Vec<Diagnostic>,
}

impl Legibility {
    /// Guarda un elemento modificabile visibile. `context` è quello
    /// dell'elemento, con i suoi attributi già applicati; `paths` è il `d`
    /// dei tracciati delle risorse, per id (formato della scena, testo).
    #[allow(clippy::too_many_arguments)]
    pub fn element(
        &mut self,
        doc: &Document<'_>,
        element: &Element<'_>,
        role: Role,
        context: &Context<'_>,
        span: Span,
        stroke: Option<&Stroke>,
        paths: &HashMap<String, String>,
    ) {
        let m = *context.matrix();
        let at = |name: &str| len(element, name).unwrap_or(0.0);
        let shape = match role {
            Role::Stroke => {
                if stroke.is_some_and(|stroke| stroke.tool == Tool::Pen) {
                    if let Some(color) = context.fill() {
                        let probes = outline_probes(element, &m);
                        self.check(span, Subject::Pen { color, probes });
                    }
                }
                return;
            }
            Role::Text => {
                self.text(doc, element, context, span, paths);
                return;
            }
            Role::Image => {
                if !decorative(element) && !described(doc, element) {
                    self.found
                        .push(Diagnostic::new(Code::S012, Some(span), None));
                }
                let r = rect_path(at("x"), at("y"), at("width"), at("height"), 0.0, 0.0);
                self.paint(r, m, None, span);
                return;
            }
            Role::Rect => {
                let [rx, ry] = radii(element);
                rect_path(at("x"), at("y"), at("width"), at("height"), rx, ry)
            }
            Role::Ellipse => ellipse_path([at("cx"), at("cy")], radii(element)),
            Role::Circle => ellipse_path([at("cx"), at("cy")], [at("r"), at("r")]),
            Role::Polygon | Role::Polyline => points_path(
                &element
                    .value(NS_NONE, "points")
                    .and_then(points)
                    .unwrap_or_default(),
            ),
            Role::Path | Role::Arrow | Role::Connector | Role::Ngon | Role::Star | Role::Width => {
                element
                    .value(NS_NONE, "d")
                    .and_then(parse_path)
                    .unwrap_or_default()
            }
            _ => return,
        };
        match context.fill_paint() {
            // Un riempimento ignoto copre come un'immagine.
            None => self.paint(shape, m, None, span),
            Some(Some((rgb, alpha))) if alpha > 0.0 => {
                self.paint(shape, m, Some((rgb, alpha)), span)
            }
            Some(_) => {}
        }
    }

    fn check(&mut self, span: Span, subject: Subject) {
        self.checks.push(Check {
            span,
            subject,
            under: self.painted.len(),
        });
    }

    fn paint(
        &mut self,
        segments: Vec<Segment>,
        matrix: Matrix,
        paint: Option<(Rgb, f64)>,
        span: Span,
    ) {
        let mut bounds = BoundsBuilder::default();
        bounds.path(&segments, &matrix);
        if let Some(bounds) = bounds.finish() {
            self.painted.push(Painted {
                segments,
                matrix,
                bounds,
                polygons: OnceCell::new(),
                paint,
                span,
            });
        }
    }

    /// Le righe di un testo, con S013 se la più piccola sta sotto
    /// [`MIN_TEXT_SIZE`] a grandezza naturale. Le righe vuote o nascoste non
    /// si guardano.
    fn text(
        &mut self,
        doc: &Document<'_>,
        element: &Element<'_>,
        context: &Context<'_>,
        span: Span,
        paths: &HashMap<String, String>,
    ) {
        let m = *context.matrix();
        // Quanto la matrice allunga il verticale: l'altezza dei caratteri.
        // Una radice quadrata e non `hypot`, che JavaScript può calcolare
        // diversamente nell'ultima cifra binaria.
        let [_, _, c, d, _, _] = m.0;
        let scale = (c * c + d * d).sqrt();
        let mut lines = Vec::new();
        let mut smallest: Option<f64> = None;
        for (child, base, up) in starts(doc, element, paths) {
            let tspan = doc.element(child).expect("una riga è un elemento");
            let line = context.line(tspan);
            if line.hidden() {
                continue;
            }
            let lift = LINE_PROBE * line.font_size().unwrap_or(DEFAULT_FONT_SIZE);
            let at = m.apply([base[0] + lift * up[0], base[1] + lift * up[1]]);
            // Il testo della riga e ogni pezzo, ciascuno col suo aspetto:
            // senza i caratteri non si sa dove cade un pezzo, e lo si guarda
            // dove comincia la riga.
            let mut words = String::new();
            let mut pieces = Vec::new();
            for &part in doc.children(child) {
                match &doc.nodes[part].kind {
                    Kind::Element(piece) => pieces.push((line.line(piece), part)),
                    Kind::Text { value, .. } => words.push_str(value),
                    _ => {}
                }
            }
            let runs =
                std::iter::once((line, words)).chain(pieces.into_iter().map(|(piece, part)| {
                    let mut words = String::new();
                    text_content(doc, part, &mut words);
                    (piece, words)
                }));
            for (look, words) in runs {
                if look.hidden() || collapse(&words).is_empty() {
                    continue;
                }
                let size = look.font_size().map(|size| size * scale);
                if let Some(size) = size {
                    smallest = Some(smallest.map_or(size, |s: f64| s.min(size)));
                }
                // Un testo di grandezza ignota conta come un testo normale.
                let large =
                    size.is_some_and(|s| s >= LARGE_TEXT || (look.bold() && s >= LARGE_BOLD_TEXT));
                lines.push(Line {
                    at,
                    color: look.fill_paint().flatten(),
                    threshold: if large {
                        MIN_CONTRAST
                    } else {
                        MIN_TEXT_CONTRAST
                    },
                });
            }
        }
        if let Some(size) = smallest.filter(|&size| size < MIN_TEXT_SIZE) {
            self.found
                .push(Diagnostic::new(Code::S013, Some(span), Some(shown(size))));
        }
        if !lines.is_empty() {
            self.check(span, Subject::Text { lines });
        }
    }

    /// Chiude i controlli: S009 per ogni oggetto che contrasta poco col suo
    /// fondo, S017 per ogni colore di codice confuso con un altro, poi S012 e
    /// S013. `paper` è il colore della carta, `None` se non si sa.
    pub fn finish(self, paper: Option<Rgb>, diagnostics: &mut Vec<Diagnostic>) {
        for check in &self.checks {
            let backdrop = |p: [f64; 2]| self.backdrop(paper, check.under, p);
            let worst = match &check.subject {
                Subject::Pen {
                    color: (rgb, alpha),
                    probes,
                } => {
                    let mut ratios: Vec<f64> = probes
                        .iter()
                        .filter_map(|&p| backdrop(p))
                        .map(|under| contrast(over(*rgb, *alpha, under), under))
                        .collect();
                    ratios.sort_by(f64::total_cmp);
                    // La mediana bassa, quando i punti sono pari.
                    ratios
                        .get(ratios.len().saturating_sub(1) / 2)
                        .copied()
                        .filter(|&median| median < MIN_CONTRAST)
                }
                Subject::Text { lines } => lines
                    .iter()
                    .filter_map(|line| {
                        let (rgb, alpha) = line.color?;
                        let under = backdrop(line.at)?;
                        let ratio = contrast(over(rgb, alpha, under), under);
                        (ratio < line.threshold).then_some(ratio)
                    })
                    .min_by(f64::total_cmp),
            };
            if let Some(ratio) = worst {
                diagnostics.push(Diagnostic::new(
                    Code::S009,
                    Some(check.span),
                    Some(shown(ratio)),
                ));
            }
        }
        self.confused(paper, diagnostics);
        diagnostics.extend(self.found);
    }

    /// S017: i colori di codice che si distinguono da un altro soltanto per
    /// la tinta. Le aree si guardano in ordine di documento, come sono
    /// dipinte.
    fn confused(&self, paper: Option<Rgb>, diagnostics: &mut Vec<Diagnostic>) {
        // I colori composti delle aree, in ordine di prima comparsa, con
        // la prima area e quante sono.
        let mut tints: Vec<Tint> = Vec::new();
        let mut seen: HashMap<Rgb, usize> = HashMap::new();
        for painted in &self.painted {
            let Some((rgb, alpha)) = painted.paint else {
                continue;
            };
            let Bounds { min, max } = painted.bounds;
            if max[0] <= min[0] || max[1] <= min[1] {
                continue;
            }
            // Una figura opaca ha il suo colore anche su una carta ignota.
            let color = if alpha >= 1.0 {
                rgb
            } else if let Some(under) = paper {
                over(rgb, alpha, under)
            } else {
                continue;
            };
            let at = *seen.entry(color).or_insert_with(|| {
                tints.push(Tint {
                    color,
                    first: painted.span,
                    areas: 0,
                });
                tints.len() - 1
            });
            tints[at].areas += 1;
        }
        let codes: Vec<&Tint> = tints.iter().filter(|tint| tint.areas >= 2).collect();
        if codes.len() > MAX_CODES {
            return;
        }
        for tint in &codes {
            // Il compagno col contrasto più basso, e a parità il primo.
            let mut worst: Option<(&Tint, f64)> = None;
            for other in &codes {
                if other.color == tint.color {
                    continue;
                }
                let ratio = contrast(tint.color, other.color);
                if ratio < MIN_CONTRAST && worst.is_none_or(|(_, lowest)| ratio < lowest) {
                    worst = Some((other, ratio));
                }
            }
            if let Some((other, ratio)) = worst {
                diagnostics.push(Diagnostic::new(
                    Code::S017,
                    Some(tint.first),
                    Some(format!(
                        "{} {} {}",
                        hex(tint.color),
                        hex(other.color),
                        shown(ratio)
                    )),
                ));
            }
        }
    }

    /// Il colore sotto il punto `p` della radice, con le prime `under` figure
    /// dipinte sopra la carta; `None` se non si sa.
    fn backdrop(&self, paper: Option<Rgb>, under: usize, p: [f64; 2]) -> Option<Rgb> {
        let mut color = paper;
        for painted in &self.painted[..under] {
            if !painted.covers(p) {
                continue;
            }
            color = match painted.paint {
                // Una figura opaca copre anche un fondo ignoto.
                Some((rgb, alpha)) if alpha >= 1.0 => Some(rgb),
                Some((rgb, alpha)) => color.map(|under| over(rgb, alpha, under)),
                None => None,
            };
        }
        color
    }
}

/// Un colore come lo scrive il file: `#rrggbb`, in minuscolo.
fn hex(rgb: Rgb) -> String {
    format!("#{:02x}{:02x}{:02x}", rgb[0], rgb[1], rgb[2])
}

/// Un numero del dettaglio, troncato ai centesimi e non arrotondato: un
/// contrasto di 2,996 non deve leggersi «3.00».
fn shown(value: f64) -> String {
    let shown = (value * 100.0).floor() / 100.0;
    format!("{shown:.2}")
}

/// Una riga di un testo: il nodo, il punto dove comincia e la direzione in
/// alto dei caratteri, lunga 1.
type Start = (NodeId, [f64; 2], [f64; 2]);

/// Le righe di un testo: i `tspan`, coi loro `x` e `dy`, o il `textPath`, nel
/// punto di `startOffset` sul tracciato. Un testo su un tracciato lungo zero
/// non ha righe.
fn starts(
    doc: &Document<'_>,
    element: &Element<'_>,
    paths: &HashMap<String, String>,
) -> Vec<Start> {
    let mut out = Vec::new();
    let x = len(element, "x").unwrap_or(0.0);
    let mut y = len(element, "y").unwrap_or(0.0);
    for &child in &element.children {
        let Some(node) = doc.element(child) else {
            continue;
        };
        if node.is_svg("textPath") {
            let (distance, share) = node
                .value(NS_NONE, "startOffset")
                .and_then(start_offset)
                .unwrap_or((0.0, false));
            let found = followed(doc, element, paths)
                .and_then(|d| along(&parse_path(d).unwrap_or_default(), distance, share));
            // Sopra il tracciato, nel suo verso, stanno i caratteri.
            if let Some(found) = found {
                let [dx, dy] = found.direction;
                out.push((child, found.at, [dy, -dx]));
            }
            return out;
        }
        if !node.is_svg("tspan") {
            continue;
        }
        y += len(node, "dy").unwrap_or(0.0);
        out.push((child, [len(node, "x").unwrap_or(x), y], [0.0, -1.0]));
    }
    out
}

/// I punti in cui si misura un tratto, nella radice: gli estremi dei segmenti
/// del contorno, o [`STROKE_PROBES`] di loro a distanze uguali nell'elenco
/// quando sono di più.
fn outline_probes(element: &Element<'_>, m: &Matrix) -> Vec<[f64; 2]> {
    let ends: Vec<[f64; 2]> = element
        .value(NS_NONE, "d")
        .and_then(parse_path)
        .unwrap_or_default()
        .iter()
        .filter_map(|segment| match *segment {
            Segment::Move(p) | Segment::Line(p) | Segment::Quad(_, p) | Segment::Cubic(_, _, p) => {
                Some(p)
            }
            Segment::Arc { to, .. } => Some(to),
            Segment::Close => None,
        })
        .collect();
    if ends.len() <= STROKE_PROBES {
        return ends.iter().map(|&p| m.apply(p)).collect();
    }
    (0..STROKE_PROBES)
        .map(|k| m.apply(ends[k * (ends.len() - 1) / (STROKE_PROBES - 1)]))
        .collect()
}

/// Vero se l'immagine dice di essere decorativa, con `aria-hidden="true"`:
/// chi legge con lo screen reader non la incontra, e non serve descriverla.
fn decorative(element: &Element<'_>) -> bool {
    element
        .value(NS_NONE, "aria-hidden")
        .is_some_and(|value| trim(value) == "true")
}

/// Vero se l'elemento ha un `title` o un `desc` con del testo.
fn described(doc: &Document<'_>, element: &Element<'_>) -> bool {
    element.children.iter().any(|&child| {
        doc.element(child)
            .is_some_and(|e| e.is_svg("title") || e.is_svg("desc"))
            && {
                let mut text = String::new();
                text_content(doc, child, &mut text);
                !collapse(&text).is_empty()
            }
    })
}
