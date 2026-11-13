//! Le misure e i posti di una scheda della lavagna.
//!
//! Dove nasce una scheda e quanto è grande lo decide il nucleo, con una regola
//! sola: le forme brevi di `add_card`, `layout`, `group`, le letture e la GUI
//! passano di qui e ottengono lo stesso numero. Sono funzioni pure, come il
//! resto del modello: niente DOM, niente font, niente rete. Il testo si misura
//! con una stima fissa e non con le metriche del font, così la stessa lavagna
//! dà gli stessi posti in Rust, in WebAssembly e da riga di comando.
//!
//! Le cifre stanno nelle costanti qui sotto; le regole seguono quelle che la
//! GUI usa già (`apps/client/src/editors/canvas/engine.ts`). Nessuna funzione
//! va in panico su un numero non finito. Dove una misura del contenuto non
//! ha senso si torna alla misura di serie; altrove il risultato non è finito,
//! e chi chiama lo rifiuta prima di scriverlo.

pub mod arrange;

use crate::model::{Canvas, CanvasEdgeSide, CanvasNode, CanvasNodeType, MAX_SAFE_INTEGER};

/// Il passo dell'aggancio alla griglia: `CANVAS_SNAP` di `engine.ts`.
const SNAP: f64 = 8.0;
/// Lo spazio fra schede impilate: sopra o sotto una scheda, sotto la
/// precedente in una lista automatica, il margine dello scivolamento.
const STACK_GAP: f64 = 24.0;
/// Lo spazio fra schede affiancate: a destra o a sinistra di una scheda, e a
/// destra del contenuto per una scheda automatica.
const SIDE_GAP: f64 = 48.0;
/// La misura più piccola di un lato, per le misure che vengono dalle proporzioni.
const MIN_SIDE: f64 = 40.0;
/// Quanti scivolamenti al più prima di rinunciare e andare oltre tutto.
const MAX_SLIDES: usize = 1000;

/// Il lato lungo di un'immagine appena nata.
const IMAGE_SIDE: f64 = 480.0;
/// La larghezza di una scheda PDF appena nata.
const PDF_WIDTH: f64 = 360.0;

/// Il margine del testo: 32 tolti alla larghezza prima di contare i caratteri
/// di una riga, e 32 in più all'altezza.
const TEXT_PAD: f64 = 32.0;
/// La larghezza di un carattere nella stima del testo.
const CHAR_WIDTH: f64 = 8.0;
/// L'altezza di una riga nella stima del testo.
const LINE_HEIGHT: f64 = 24.0;
/// Quanti caratteri per riga al più: mai meno di otto.
const MIN_CHARS_PER_LINE: f64 = 8.0;
/// La larghezza di nascita di un testo con righe corte.
const TEXT_NARROW: f64 = 320.0;
/// La larghezza di nascita di un testo con una riga lunga.
const TEXT_WIDE: f64 = 480.0;
/// Fino a quanti caratteri una riga sta nella larghezza stretta.
const TEXT_NARROW_CHARS: usize = 36;
/// L'altezza più piccola di un testo.
const TEXT_MIN_HEIGHT: f64 = 160.0;
/// L'altezza più grande di un testo.
const TEXT_MAX_HEIGHT: f64 = 1600.0;

/// Il più grande lato che un intero sicuro tiene: il limite del modello.
const MAX_SIDE: f64 = MAX_SAFE_INTEGER as f64;

/// La specie di una scheda: da lei dipendono la misura di nascita e il posto.
///
/// `Craft` è la specie di un file Craft. Nessuna estensione la produce ancora
/// ([`card_kind`] non la dà), e la darà il riconoscimento di Craft.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CardKind {
    /// Un testo scritto nella scheda.
    Text,
    /// Un file Markdown.
    Note,
    /// Un documento di testo (Word, RTF, OpenDocument).
    Document,
    /// Un foglio di calcolo.
    Sheet,
    /// Un PDF.
    Pdf,
    /// Un'immagine.
    Image,
    /// Un collegamento a una pagina web.
    Web,
    /// Un file Craft.
    Craft,
    /// Ogni altro file.
    File,
    /// Un gruppo che raccoglie altre schede.
    Group,
}

/// Un rettangolo sulla lavagna, in unità della lavagna. Le posizioni possono
/// non essere intere (un `gap` non intero le porta fuori): chi scrive il modello
/// decide come portarle a interi.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    /// Il bordo sinistro.
    pub x: f64,
    /// Il bordo alto.
    pub y: f64,
    /// La larghezza.
    pub width: f64,
    /// L'altezza.
    pub height: f64,
}

impl Rect {
    /// Il rettangolo di una scheda del modello.
    pub fn of_node(node: &CanvasNode) -> Self {
        Self {
            x: node.x as f64,
            y: node.y as f64,
            width: node.width as f64,
            height: node.height as f64,
        }
    }

    /// Il bordo destro.
    fn right(&self) -> f64 {
        self.x + self.width
    }

    /// Il bordo basso.
    fn bottom(&self) -> f64 {
        self.y + self.height
    }
}

/// L'aggancio alla griglia: `floor(v / 8 + 0.5) * 8`, come `Math.round` di
/// `engine.ts` (la metà sale). Un valore non finito resta non finito.
pub fn snap(value: f64) -> f64 {
    (value / SNAP + 0.5).floor() * SNAP
}

/// La specie di una scheda del modello.
///
/// Un testo è `Text`, un link è `Web`, un gruppo è `Group`. Una scheda `file`
/// prende la specie dall'estensione del suo percorso, in minuscolo: la parte
/// dal primo `#` in poi non conta (il sottopercorso), come nella GUI. `md` e
/// `markdown` sono `Note`, le estensioni di documento `Document`, quelle di
/// foglio `Sheet`, `pdf` è `Pdf`, le immagini `Image`. Ogni altra estensione, o
/// nessuna, è `File`.
pub fn card_kind(node: &CanvasNode) -> CardKind {
    match node.node_type {
        CanvasNodeType::Text => CardKind::Text,
        CanvasNodeType::Link => CardKind::Web,
        CanvasNodeType::Group => CardKind::Group,
        CanvasNodeType::File => node.file.as_deref().map_or(CardKind::File, kind_of_path),
    }
}

/// La specie di un percorso, dall'estensione dell'ultimo componente. Un punto
/// nelle cartelle non conta: `cartella.v2/nota` non ha estensione. Un punto in
/// testa al nome non apre un'estensione: `.md` è un nome nascosto, e `File`.
fn kind_of_path(path: &str) -> CardKind {
    let path = path.split('#').next().unwrap_or(path);
    let name = path.rsplit('/').next().unwrap_or(path);
    let Some(point) = name.rfind('.').filter(|&point| point > 0) else {
        return CardKind::File;
    };
    let extension = &name[point + 1..];
    match extension.to_ascii_lowercase().as_str() {
        "md" | "markdown" => CardKind::Note,
        "docx" | "doc" | "dot" | "rtf" | "odt" => CardKind::Document,
        "xlsx" | "xlsm" | "xltx" | "xltm" => CardKind::Sheet,
        "pdf" => CardKind::Pdf,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" | "heic"
        | "tif" | "tiff" => CardKind::Image,
        _ => CardKind::File,
    }
}

/// La misura di nascita di una scheda di specie `kind`, in unità della lavagna.
///
/// Il testo prende la larghezza 320, o 480 se una riga ha più di 36 caratteri,
/// e l'altezza stimata da [`estimate_text_height`]. `content` è la misura del
/// contenuto: i punti della prima pagina di un PDF, i pixel di un'immagine.
/// Con una misura finita e positiva, un PDF è largo 360 e alto secondo la sua
/// pagina, un'immagine ha il lato lungo 480 e l'altro secondo le proporzioni.
/// Senza misura (o con una misura non finita, non positiva, o che fa uscire il
/// lato dai limiti del modello) vale la misura di serie. Nessun lato, calcolato
/// dalle proporzioni, scende sotto 40.
pub fn born_size(kind: CardKind, text: Option<&str>, content: Option<(f64, f64)>) -> (f64, f64) {
    match kind {
        CardKind::Text => {
            let text = text.unwrap_or("");
            let width = if line_chars(text).all(|chars| chars <= TEXT_NARROW_CHARS) {
                TEXT_NARROW
            } else {
                TEXT_WIDE
            };
            (width, estimate_text_height(text, width))
        }
        CardKind::Note | CardKind::Document => (320.0, 240.0),
        CardKind::Sheet => (480.0, 304.0),
        CardKind::Pdf => known_content(content)
            .and_then(|(width, height)| {
                proportional(PDF_WIDTH * height / width).map(|side| (PDF_WIDTH, side))
            })
            .unwrap_or((PDF_WIDTH, 480.0)),
        CardKind::Image => known_content(content)
            .and_then(|(width, height)| {
                if width >= height {
                    proportional(IMAGE_SIDE * height / width).map(|side| (IMAGE_SIDE, side))
                } else {
                    proportional(IMAGE_SIDE * width / height).map(|side| (side, IMAGE_SIDE))
                }
            })
            .unwrap_or((IMAGE_SIDE, 360.0)),
        CardKind::Web => (320.0, 120.0),
        CardKind::Craft | CardKind::File => (320.0, 160.0),
        CardKind::Group => (480.0, 320.0),
    }
}

/// L'altezza stimata di un testo di larghezza `width`, in unità della lavagna.
///
/// Una riga contiene `cpl = max(8, floor((width − 32) / 8))` caratteri. Le
/// righe sono quelle separate da `\n` (o `\r\n`, dove il `\r` fa parte del
/// separatore) e ciascuna vale `max(1, ceil(punti di codice / cpl))`. L'altezza
/// è `clamp(snap(24 · righe + 32), 160, 1600)`: il testo vuoto è alto 160, il
/// testo più lungo di 10 000 righe è alto 1600.
pub fn estimate_text_height(text: &str, width: f64) -> f64 {
    let per_line = ((width - TEXT_PAD) / CHAR_WIDTH)
        .floor()
        .max(MIN_CHARS_PER_LINE);
    let rows: f64 = line_chars(text)
        .map(|chars| (chars as f64 / per_line).ceil().max(1.0))
        .sum();
    snap(LINE_HEIGHT * rows + TEXT_PAD).clamp(TEXT_MIN_HEIGHT, TEXT_MAX_HEIGHT)
}

/// Il posto di una scheda senza `x`, `y` né `near`.
///
/// Se c'è `after`, cioè la scheda precedente della stessa lista, la scheda va
/// sotto di lei a 24, con la sua x. Altrimenti, su una lavagna vuota va in 0,0;
/// su una lavagna con schede va a 48 a destra della scheda più a destra, alla y
/// della più alta. Le schede sono tutte quelle del modello, gruppi compresi.
pub fn auto_place(canvas: &Canvas, after: Option<Rect>) -> (f64, f64) {
    if let Some(previous) = after {
        return (previous.x, previous.bottom() + STACK_GAP);
    }
    let right = canvas
        .nodes
        .iter()
        .map(|node| i128::from(node.x) + i128::from(node.width))
        .max();
    let top = canvas.nodes.iter().map(|node| node.y).min();
    match (right, top) {
        (Some(right), Some(top)) => (right as f64 + SIDE_GAP, top as f64),
        _ => (0.0, 0.0),
    }
}

/// Il rettangolo di una scheda messa accanto alla scheda `near`, sul lato
/// `side`, a `gap` da lei (di serie 48 a destra e a sinistra, 24 sopra e sotto).
///
/// La scheda nasce con la sua misura di nascita; un testo sopra o sotto prende
/// la larghezza di `near`, e la sua altezza si stima su quella. A destra e a
/// sinistra la y è quella di `near`; sopra e sotto la x è quella di `near`.
/// Se il posto è preso da un'altra scheda che non è un gruppo (e non è `near`),
/// la scheda scivola sull'asse perpendicolare al lato, oltre la scheda che lo
/// occupa, a 24 da lei, finché trova un posto libero. Al più [`MAX_SLIDES`]
/// passi: se non basta, va oltre tutte le schede, sullo stesso asse.
///
/// Dà `None` se `near` non c'è nella lavagna: lo dice il chiamante.
pub fn place_near(
    canvas: &Canvas,
    near: &str,
    side: CanvasEdgeSide,
    gap: Option<f64>,
    kind: CardKind,
    text: Option<&str>,
    content: Option<(f64, f64)>,
) -> Option<Rect> {
    let node = canvas.nodes.iter().find(|node| node.id.as_str() == near)?;
    let anchor = Rect::of_node(node);
    let above_or_below = matches!(side, CanvasEdgeSide::Top | CanvasEdgeSide::Bottom);
    let gap = gap.unwrap_or(if above_or_below { STACK_GAP } else { SIDE_GAP });
    let (mut width, mut height) = born_size(kind, text, content);
    if above_or_below && kind == CardKind::Text {
        width = anchor.width;
        height = estimate_text_height(text.unwrap_or(""), width);
    }
    let (x, y) = match side {
        CanvasEdgeSide::Right => (anchor.right() + gap, anchor.y),
        CanvasEdgeSide::Left => (anchor.x - gap - width, anchor.y),
        CanvasEdgeSide::Bottom => (anchor.x, anchor.bottom() + gap),
        CanvasEdgeSide::Top => (anchor.x, anchor.y - gap - height),
    };
    let axis = if above_or_below {
        Axis::Horizontal
    } else {
        Axis::Vertical
    };
    Some(slide(
        canvas,
        near,
        Rect {
            x,
            y,
            width,
            height,
        },
        axis,
    ))
}

/// L'asse lungo cui una scheda scivola quando trova un posto preso.
#[derive(Clone, Copy)]
enum Axis {
    /// Verso il basso, per un lato a destra o a sinistra.
    Vertical,
    /// Verso destra, per un lato sopra o sotto.
    Horizontal,
}

/// Il primo posto libero, partendo da `start` e scivolando sull'asse dato.
///
/// Un posto è preso da una scheda quando le due hanno un'area in comune: un
/// bordo che combacia non conta, come in `anchor.ts`. I gruppi non fanno
/// ostacolo, e `near` non fa ostacolo a sé stessa. Dopo [`MAX_SLIDES`]
/// scivolamenti, se il posto è ancora preso, va oltre tutte le schede.
fn slide(canvas: &Canvas, near: &str, start: Rect, axis: Axis) -> Rect {
    let mut rect = start;
    let mut steps = 0;
    while let Some(blocker) = canvas.nodes.iter().find(|node| {
        node.id.as_str() != near
            && node.node_type != CanvasNodeType::Group
            && overlaps(&rect, &Rect::of_node(node))
    }) {
        if steps == MAX_SLIDES {
            return beyond_all(canvas, start, axis);
        }
        let blocked = Rect::of_node(blocker);
        match axis {
            Axis::Vertical => rect.y = blocked.bottom() + STACK_GAP,
            Axis::Horizontal => rect.x = blocked.right() + STACK_GAP,
        }
        steps += 1;
    }
    rect
}

/// Il posto oltre tutte le schede, sull'asse dato: sotto la più bassa, o a
/// destra della più a destra, a 24 di distanza. La coordinata perpendicolare
/// resta quella di partenza.
fn beyond_all(canvas: &Canvas, start: Rect, axis: Axis) -> Rect {
    match axis {
        Axis::Vertical => {
            let bottom = canvas
                .nodes
                .iter()
                .map(|node| i128::from(node.y) + i128::from(node.height))
                .max()
                .unwrap_or(0);
            Rect {
                y: bottom as f64 + STACK_GAP,
                ..start
            }
        }
        Axis::Horizontal => {
            let right = canvas
                .nodes
                .iter()
                .map(|node| i128::from(node.x) + i128::from(node.width))
                .max()
                .unwrap_or(0);
            Rect {
                x: right as f64 + STACK_GAP,
                ..start
            }
        }
    }
}

/// Se due rettangoli hanno un'area in comune. Un bordo che combacia non conta.
pub(crate) fn overlaps(a: &Rect, b: &Rect) -> bool {
    a.x < b.right() && b.x < a.right() && a.y < b.bottom() && b.y < a.bottom()
}

/// Se la scheda `card` sta tutta dentro il gruppo `group`: il rettangolo della
/// scheda è nel rettangolo del gruppo, bordi compresi. Come la regola con cui il
/// trascinamento di `engine.ts` porta le schede dentro un gruppo, una scheda
/// non è mai dentro sé stessa.
pub fn inside(card: &CanvasNode, group: &CanvasNode) -> bool {
    if card.id == group.id {
        return false;
    }
    let (left, top) = (i128::from(card.x), i128::from(card.y));
    let (right, bottom) = (left + i128::from(card.width), top + i128::from(card.height));
    let (group_left, group_top) = (i128::from(group.x), i128::from(group.y));
    let (group_right, group_bottom) = (
        group_left + i128::from(group.width),
        group_top + i128::from(group.height),
    );
    left >= group_left && top >= group_top && right <= group_right && bottom <= group_bottom
}

/// I lati più vicini fra due schede, per un arco di `sides: "auto"`: il lato
/// di `from` e il lato di `to`.
///
/// Si confrontano i centri. Se la distanza in orizzontale è almeno quella in
/// verticale, si va da destra a sinistra (o da sinistra a destra se `to` sta a
/// sinistra); se no, da basso in alto (o da alto in basso se `to` sta sopra).
/// Una scheda con sé stessa dà destra e sinistra.
pub fn nearest_sides(from: &CanvasNode, to: &CanvasNode) -> (CanvasEdgeSide, CanvasEdgeSide) {
    // Il doppio del centro, per restare nei numeri interi.
    let dx = doubled_centre(to.x, to.width) - doubled_centre(from.x, from.width);
    let dy = doubled_centre(to.y, to.height) - doubled_centre(from.y, from.height);
    if dx.abs() >= dy.abs() {
        if dx < 0 {
            (CanvasEdgeSide::Left, CanvasEdgeSide::Right)
        } else {
            (CanvasEdgeSide::Right, CanvasEdgeSide::Left)
        }
    } else if dy < 0 {
        (CanvasEdgeSide::Top, CanvasEdgeSide::Bottom)
    } else {
        (CanvasEdgeSide::Bottom, CanvasEdgeSide::Top)
    }
}

/// Il doppio del centro di una scheda su un asse, in un intero.
fn doubled_centre(origin: i64, size: i64) -> i128 {
    2 * i128::from(origin) + i128::from(size)
}

/// Il rettangolo che racchiude le schede `rects`, allargato di `margin` per
/// lato e agganciato: ciascuno dei quattro valori (x, y, larghezza, altezza)
/// passa da [`snap`], come fa `engine.ts` con le misure. Dà `None` se non c'è
/// nessuna scheda.
pub fn group_rect(rects: &[Rect], margin: f64) -> Option<Rect> {
    let (first, rest) = rects.split_first()?;
    let (left, top, right, bottom) = rest.iter().fold(
        (first.x, first.y, first.right(), first.bottom()),
        |(left, top, right, bottom), rect| {
            (
                left.min(rect.x),
                top.min(rect.y),
                right.max(rect.right()),
                bottom.max(rect.bottom()),
            )
        },
    );
    Some(Rect {
        x: snap(left - margin),
        y: snap(top - margin),
        width: snap(right - left + 2.0 * margin),
        height: snap(bottom - top + 2.0 * margin),
    })
}

/// Le righe del testo, ciascuna con i suoi punti di codice. Una riga finisce a
/// `\n`, o a `\r\n`, e il `\r` non conta. Il testo vuoto ha una riga, e un testo
/// che finisce con `\n` ha una riga vuota in fondo.
fn line_chars(text: &str) -> impl Iterator<Item = usize> + '_ {
    let mut pieces = text.split('\n').peekable();
    std::iter::from_fn(move || {
        let piece = pieces.next()?;
        let body = match pieces.peek() {
            Some(_) => piece.strip_suffix('\r').unwrap_or(piece),
            None => piece,
        };
        Some(body.chars().count())
    })
}

/// La misura del contenuto, se è finita e positiva nei due lati.
fn known_content(content: Option<(f64, f64)>) -> Option<(f64, f64)> {
    content.filter(|(width, height)| positive(*width) && positive(*height))
}

fn positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

/// Un lato calcolato dalle proporzioni: agganciato, non sotto 40. Un valore che
/// non è finito, o che non sta in un intero sicuro, non dà nulla: vale la
/// misura di serie.
fn proportional(value: f64) -> Option<f64> {
    let side = snap(value);
    (side.is_finite() && side <= MAX_SIDE).then_some(side.max(MIN_SIDE))
}
