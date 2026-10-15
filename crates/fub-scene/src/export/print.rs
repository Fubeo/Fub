//! La pagina di stampa di un PDF: la carta, i margini, l'abbondanza, i segni
//! di taglio e di registro, e dove va il disegno. Il client fa lo stesso conto
//! per l'anteprima della finestra «Esporta» e per dire la misura: i vettori di
//! `print.json` lo provano nei due linguaggi.
//!
//! Le misure di chi chiede sono in millimetri, quelle della pagina in punti
//! PDF, con l'origine in alto a sinistra come nel disegno. Il rettangolo che
//! si taglia è la **rifilatura**: la tavola, la selezione o il disegno, a 0,75
//! punti per pixel per la scala. L'abbondanza lo allarga per lato con ciò che
//! il disegno ha oltre il bordo, e i segni stanno fuori dall'abbondanza.
//!
//! - **La carta su misura** ([`Paper::Fit`]) è la rifilatura con l'abbondanza
//!   e, se ci sono, lo spazio dei segni: la pagina di sempre, se non c'è né
//!   l'una né gli altri. Il disegno resta alla sua misura.
//! - **Una carta col suo formato** si gira come il disegno o come si chiede,
//!   e il disegno ci sta al centro, dentro i margini, con l'abbondanza e i
//!   segni: alla sua misura, ridotto se non ci sta ([`Fit::Shrink`]), o grande
//!   quanto la carta permette ([`Fit::Page`]).

/// Punti per millimetro: 72 per pollice, 25,4 millimetri per pollice.
pub const PT_PER_MM: f64 = 72.0 / 25.4;
/// Punti per pixel CSS: 72 per pollice contro 96.
pub const PT_PER_PX: f64 = 0.75;

/// I formati di carta che hanno un nome, in millimetri, col lato corto prima.
pub const PAPERS: [(&str, [f64; 2]); 8] = [
    ("a2", [420.0, 594.0]),
    ("a3", [297.0, 420.0]),
    ("a4", [210.0, 297.0]),
    ("a5", [148.0, 210.0]),
    ("a6", [105.0, 148.0]),
    ("letter", [215.9, 279.4]),
    ("legal", [215.9, 355.6]),
    ("tabloid", [279.4, 431.8]),
];

/// Il lato più corto di una carta su richiesta, in millimetri.
pub const PAPER_MIN_MM: f64 = 10.0;
/// Il lato più lungo di una carta su richiesta: 5 metri, che in punti stanno
/// ancora sotto il lato massimo di una pagina PDF senza un'unità più grande.
pub const PAPER_MAX_MM: f64 = 5000.0;
/// Il margine più largo, in millimetri.
pub const MARGIN_MAX_MM: f64 = 100.0;
/// Il margine di serie con una carta col suo formato: più largo del bordo che
/// una stampante da ufficio non raggiunge.
pub const MARGIN_DEFAULT_MM: f64 = 10.0;
/// L'abbondanza più larga, in millimetri.
pub const BLEED_MAX_MM: f64 = 25.0;
/// Quanto un segno sta lontano dal bordo dell'abbondanza, o della rifilatura
/// se non c'è abbondanza, in millimetri.
pub const MARK_GAP_MM: f64 = 3.0;
/// Quanto è lungo un segno di taglio, e quanto è largo un segno di registro.
pub const MARK_LENGTH_MM: f64 = 5.0;
/// Il raggio del cerchio di un segno di registro, in millimetri.
pub const REGISTRATION_RADIUS_MM: f64 = 1.75;
/// Lo spessore delle linee dei segni, in punti: quello dei programmi di
/// impaginazione.
pub const MARK_WEIGHT_PT: f64 = 0.25;

/// La carta.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Paper {
    /// Su misura: la rifilatura, l'abbondanza e i segni.
    Fit,
    /// Un formato, in millimetri, col lato corto prima.
    Sheet([f64; 2]),
}

/// Come si gira una carta col suo formato.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Orientation {
    /// Come il disegno: orizzontale se è più largo che alto.
    Auto,
    Portrait,
    Landscape,
}

/// Quanto è grande il disegno su una carta col suo formato.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fit {
    /// Alla sua misura, ridotto se non ci sta.
    Shrink,
    /// Grande quanto la carta permette, anche ingrandito.
    Page,
}

/// I segni fuori dall'abbondanza.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Marks {
    /// Agli angoli della rifilatura, dove tagliare.
    pub crop: bool,
    /// A metà dei lati, per mettere a registro i passaggi.
    pub registration: bool,
}

impl Marks {
    pub fn any(self) -> bool {
        self.crop || self.registration
    }
}

/// Come si stampa: le scelte di chi esporta, in millimetri.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Setup {
    pub paper: Paper,
    pub orientation: Orientation,
    /// Il margine bianco dal bordo di una carta col suo formato.
    pub margin: f64,
    pub fit: Fit,
    pub bleed: f64,
    pub marks: Marks,
}

impl Setup {
    /// La pagina di sempre: la carta su misura, senza abbondanza né segni.
    pub const PLAIN: Setup = Setup {
        paper: Paper::Fit,
        orientation: Orientation::Auto,
        margin: MARGIN_DEFAULT_MM,
        fit: Fit::Shrink,
        bleed: 0.0,
        marks: Marks {
            crop: false,
            registration: false,
        },
    };

    /// Vero se la pagina è quella di sempre, grande quanto il disegno.
    pub fn is_plain(&self) -> bool {
        self.paper == Paper::Fit && self.bleed <= 0.0 && !self.marks.any()
    }

    /// Lo spazio dei segni oltre l'abbondanza, per lato, in millimetri.
    pub fn band(&self) -> f64 {
        if self.marks.any() {
            MARK_GAP_MM + MARK_LENGTH_MM
        } else {
            0.0
        }
    }

    /// Ciò che margini, abbondanza e segni prendono per lato, in millimetri,
    /// su una carta col suo formato.
    pub fn taken(&self) -> f64 {
        self.margin + self.bleed + self.band()
    }

    /// Vero se la carta lascia posto al disegno: su una carta col suo formato,
    /// il lato corto è più lungo di ciò che margini, abbondanza e segni
    /// prendono dai due lati. La carta su misura ne lascia sempre.
    pub fn has_room(&self) -> bool {
        match self.paper {
            Paper::Fit => true,
            Paper::Sheet([short, _]) => short - 2.0 * self.taken() > 0.0,
        }
    }
}

/// Il formato col nome `name`, in millimetri.
pub fn paper_named(name: &str) -> Option<[f64; 2]> {
    PAPERS
        .iter()
        .find(|(known, _)| *known == name)
        .map(|&(_, size)| size)
}

/// La pagina: tutto in punti, con l'origine in alto a sinistra.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sheet {
    /// La carta.
    pub width: f64,
    pub height: f64,
    /// La rifilatura: angolo in alto a sinistra, larghezza e altezza.
    pub trim: [f64; 4],
    /// L'abbondanza per lato.
    pub bleed: f64,
    /// Quanto è ingrandito il disegno: 1 vuol dire 0,75 punti per pixel.
    pub scale: f64,
    /// Vero se la carta col suo formato è girata in orizzontale.
    pub landscape: bool,
}

/// La pagina per un disegno di `width` × `height` pixel CSS, la misura della
/// rifilatura a scala 1, con le scelte `setup`, che lasciano posto al disegno
/// ([`Setup::has_room`]).
pub fn layout(width: f64, height: f64, setup: &Setup) -> Sheet {
    let bleed = setup.bleed.max(0.0) * PT_PER_MM;
    let natural = [width * PT_PER_PX, height * PT_PER_PX];
    match setup.paper {
        Paper::Fit => {
            let edge = bleed + setup.band() * PT_PER_MM;
            Sheet {
                width: natural[0] + 2.0 * edge,
                height: natural[1] + 2.0 * edge,
                trim: [edge, edge, natural[0], natural[1]],
                bleed,
                scale: 1.0,
                landscape: false,
            }
        }
        Paper::Sheet([short, long]) => {
            let landscape = match setup.orientation {
                Orientation::Auto => width > height,
                Orientation::Portrait => false,
                Orientation::Landscape => true,
            };
            let paper = if landscape {
                [long, short]
            } else {
                [short, long]
            };
            let (paper_w, paper_h) = (paper[0] * PT_PER_MM, paper[1] * PT_PER_MM);
            let taken = 2.0 * setup.taken() * PT_PER_MM;
            let fits = ((paper_w - taken) / natural[0]).min((paper_h - taken) / natural[1]);
            let scale = match setup.fit {
                Fit::Shrink => fits.min(1.0),
                Fit::Page => fits,
            };
            let (trim_w, trim_h) = (natural[0] * scale, natural[1] * scale);
            Sheet {
                width: paper_w,
                height: paper_h,
                trim: [
                    (paper_w - trim_w) / 2.0,
                    (paper_h - trim_h) / 2.0,
                    trim_w,
                    trim_h,
                ],
                bleed,
                scale,
                landscape,
            }
        }
    }
}

/// I segni di una pagina, in punti, con l'origine in alto a sinistra: le
/// linee da un capo all'altro e i cerchi col centro e il raggio.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct MarkShapes {
    pub lines: Vec<[f64; 4]>,
    pub circles: Vec<[f64; 3]>,
}

/// I segni `marks` intorno alla rifilatura di `sheet`. I segni di taglio
/// sono due per angolo, sul prolungamento dei lati, a [`MARK_GAP_MM`] dal
/// bordo dell'abbondanza e lunghi [`MARK_LENGTH_MM`]: in alto a sinistra, in
/// alto a destra, in basso a destra, in basso a sinistra, prima l'orizzontale.
/// I segni di registro sono un cerchio con una croce a metà di ogni lato,
/// nello stesso spazio: in alto, a destra, in basso, a sinistra.
pub fn mark_shapes(sheet: &Sheet, marks: Marks) -> MarkShapes {
    let [x, y, w, h] = sheet.trim;
    let (right, bottom) = (x + w, y + h);
    let near = sheet.bleed + MARK_GAP_MM * PT_PER_MM;
    let far = near + MARK_LENGTH_MM * PT_PER_MM;
    let mut shapes = MarkShapes::default();
    if marks.crop {
        for (cx, cy, sx, sy) in [
            (x, y, -1.0, -1.0),
            (right, y, 1.0, -1.0),
            (right, bottom, 1.0, 1.0),
            (x, bottom, -1.0, 1.0),
        ] {
            shapes.lines.push([cx + sx * near, cy, cx + sx * far, cy]);
            shapes.lines.push([cx, cy + sy * near, cx, cy + sy * far]);
        }
    }
    if marks.registration {
        let middle = (near + far) / 2.0;
        let half = MARK_LENGTH_MM * PT_PER_MM / 2.0;
        let radius = REGISTRATION_RADIUS_MM * PT_PER_MM;
        for (cx, cy) in [
            (x + w / 2.0, y - middle),
            (right + middle, y + h / 2.0),
            (x + w / 2.0, bottom + middle),
            (x - middle, y + h / 2.0),
        ] {
            shapes.circles.push([cx, cy, radius]);
            shapes.lines.push([cx - half, cy, cx + half, cy]);
            shapes.lines.push([cx, cy - half, cx, cy + half]);
        }
    }
    shapes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn the_plain_page_is_the_drawing_at_three_quarters_of_a_point() {
        assert!(Setup::PLAIN.is_plain());
        let sheet = layout(800.0, 600.0, &Setup::PLAIN);
        assert_eq!(sheet.trim, [0.0, 0.0, 600.0, 450.0]);
        assert_eq!(
            (sheet.width, sheet.height, sheet.scale),
            (600.0, 450.0, 1.0)
        );
        assert!(mark_shapes(&sheet, Marks::default()).lines.is_empty());
    }

    #[test]
    fn bleed_and_marks_grow_the_fitted_paper() {
        let setup = Setup {
            bleed: 3.0,
            marks: Marks {
                crop: true,
                registration: true,
            },
            ..Setup::PLAIN
        };
        let sheet = layout(800.0, 600.0, &setup);
        let edge = 11.0 * PT_PER_MM;
        assert!(close(sheet.trim[0], edge) && close(sheet.trim[1], edge));
        assert!(close(sheet.width, 600.0 + 2.0 * edge));
        let shapes = mark_shapes(&sheet, setup.marks);
        assert_eq!((shapes.lines.len(), shapes.circles.len()), (16, 4));
        // Il primo segno di taglio finisce sul bordo della carta.
        assert!(close(shapes.lines[0][2], 0.0));
        assert!(close(shapes.lines[0][0], 5.0 * PT_PER_MM));
    }

    #[test]
    fn a_named_paper_turns_like_the_drawing_and_centres_it() {
        let a4 = paper_named("a4").unwrap();
        let setup = Setup {
            paper: Paper::Sheet(a4),
            ..Setup::PLAIN
        };
        // Un disegno largo 1 200 pixel, 317,5 mm, non sta fra i margini di
        // un A4 orizzontale, 277 mm: si riduce.
        let sheet = layout(1200.0, 600.0, &setup);
        assert!(sheet.landscape);
        assert!(close(sheet.width, 297.0 * PT_PER_MM));
        assert!(close(sheet.trim[2], 277.0 * PT_PER_MM));
        assert!(close(sheet.trim[0], 10.0 * PT_PER_MM));
        assert!(close(sheet.trim[1] * 2.0 + sheet.trim[3], sheet.height));
        // Uno che ci sta resta alla sua misura.
        let small = layout(400.0, 200.0, &setup);
        assert_eq!(small.scale, 1.0);
        assert!(close(small.trim[2], 300.0));
        // «Adatta alla pagina» lo ingrandisce.
        let page = layout(
            400.0,
            200.0,
            &Setup {
                fit: Fit::Page,
                ..setup
            },
        );
        assert!(close(page.trim[2], 277.0 * PT_PER_MM));
        // Verticale per forza.
        let portrait = layout(
            1200.0,
            600.0,
            &Setup {
                orientation: Orientation::Portrait,
                ..setup
            },
        );
        assert!(!portrait.landscape && close(portrait.width, 210.0 * PT_PER_MM));
    }

    #[test]
    fn margins_bleed_and_marks_can_leave_no_room() {
        let setup = Setup {
            paper: Paper::Sheet(paper_named("a6").unwrap()),
            margin: 40.0,
            bleed: 5.0,
            marks: Marks {
                crop: true,
                registration: false,
            },
            ..Setup::PLAIN
        };
        // 40 + 5 + 8 = 53 per lato, 106 sul lato corto di 105.
        assert!(!setup.has_room());
        assert!(Setup {
            margin: 39.0,
            ..setup
        }
        .has_room());
    }
}
