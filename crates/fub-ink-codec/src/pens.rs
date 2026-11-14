//! Le penne di sistema e la tavolozza dell'inchiostro, come le ha la GUI.
//!
//! È la copia di `apps/client/src/ink/pens.ts` e `palette.ts`, che fanno fede:
//! un tratto scritto in codice con una penna deve avere lo stesso pennello che
//! la GUI scrive con quella penna. Sei penne sono `pf1` con altri numeri, la
//! Calligrafia è la punta piatta `nib1`; il pennello porta la penna come chiave
//! conservata (`pen=<id>`), che `pf1` e `nib1` non conoscono e tengono.
//!
//! Le due copie le lega lo specchio: `tests/pens_mirror.rs` scrive
//! `apps/client/src/__fixtures__/ink-pens.json` con i pennelli di queste
//! penne, e `apps/client/src/ink/pens-mirror.test.ts` vuole le stesse risposte
//! da `penBrush` e da `INK_PALETTE`.

use crate::brush::{Brush, InkBrush, Nib1Brush};

/// La chiave conservata che dice con quale penna è nato il tratto.
pub const PEN_KEY: &str = "pen";

/// La misura più piccola e la più grande di una penna, in unità.
pub const MIN_PEN_SIZE: f64 = 0.25;
pub const MAX_PEN_SIZE: f64 = 200.0;

/// La penna di serie della Penna.
pub const DEFAULT_PEN: &str = "ballpoint";

/// Lo strumento che usa una penna: le penne della Penna, o l'evidenziatore.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PenTool {
    Pen,
    Highlighter,
}

impl PenTool {
    /// Il nome dello strumento, quello del campo `tool` di un tratto.
    pub fn as_str(self) -> &'static str {
        match self {
            PenTool::Pen => "pen",
            PenTool::Highlighter => "highlighter",
        }
    }
}

/// Come si fonde il tratto con ciò che sta sotto.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PenBlend {
    Normal,
    Multiply,
}

impl PenBlend {
    /// Il nome della fusione, come in `pens.ts`.
    pub fn as_str(self) -> &'static str {
        match self {
            PenBlend::Normal => "normal",
            PenBlend::Multiply => "multiply",
        }
    }
}

/// La ricetta del pennello di una penna.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PenRecipe {
    /// `pf1` con questi numeri. Le rastremazioni sono multipli della misura,
    /// perché una penna più grossa resti la stessa penna; `smoothing` e
    /// `streamline` assenti valgono quelli di serie di `pf1`.
    Pf1 {
        thinning: f64,
        taper_start: f64,
        taper_end: f64,
        caps: bool,
        smoothing: Option<f64>,
        streamline: Option<f64>,
    },
    /// La punta piatta `nib1` con i suoi valori di serie; la punta (`tip`) non
    /// è mai più larga della misura.
    Nib1,
}

/// Una penna di sistema: la misura di serie, quanto copre, come si fonde, se
/// segue la pressione e la ricetta del pennello.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PenSpec {
    pub id: &'static str,
    pub tool: PenTool,
    /// La misura di serie, in unità.
    pub size: f64,
    /// Quanto copre: 1 pieno.
    pub opacity: f64,
    pub blend: PenBlend,
    /// Lo spessore segue la pressione quando il dispositivo la dà.
    pub pressure: bool,
    pub recipe: PenRecipe,
}

/// Una penna `pf1` con l'aspetto più comune: Penna, coprente, normale, con la
/// pressione. È `pf1Pen` di `pens.ts`.
const fn pf1(
    id: &'static str,
    size: f64,
    thinning: f64,
    taper_start: f64,
    taper_end: f64,
) -> PenSpec {
    PenSpec {
        id,
        tool: PenTool::Pen,
        size,
        opacity: 1.0,
        blend: PenBlend::Normal,
        pressure: true,
        recipe: PenRecipe::Pf1 {
            thinning,
            taper_start,
            taper_end,
            caps: true,
            smoothing: None,
            streamline: None,
        },
    }
}

/// Le sette penne, nell'ordine della galleria (`PEN_IDS`).
pub const PENS: [PenSpec; 7] = [
    pf1("ballpoint", 2.0, 0.25, 1.0, 4.0),
    PenSpec {
        recipe: PenRecipe::Pf1 {
            thinning: 0.6,
            taper_start: 2.0,
            taper_end: 8.0,
            caps: true,
            smoothing: Some(0.6),
            streamline: Some(0.45),
        },
        ..pf1("fountain", 3.0, 0.0, 0.0, 0.0)
    },
    PenSpec {
        recipe: PenRecipe::Pf1 {
            thinning: 0.85,
            taper_start: 4.0,
            taper_end: 8.0,
            caps: false,
            smoothing: Some(0.7),
            streamline: None,
        },
        ..pf1("brush", 10.0, 0.0, 0.0, 0.0)
    },
    PenSpec {
        opacity: 0.92,
        pressure: false,
        ..pf1("marker", 6.0, 0.0, 0.0, 0.0)
    },
    PenSpec {
        opacity: 0.8,
        ..pf1("pencil", 1.5, 0.35, 0.0, 0.0)
    },
    PenSpec {
        id: "calligraphy",
        tool: PenTool::Pen,
        size: 12.0,
        opacity: 1.0,
        blend: PenBlend::Normal,
        pressure: true,
        recipe: PenRecipe::Nib1,
    },
    PenSpec {
        tool: PenTool::Highlighter,
        opacity: 0.5,
        blend: PenBlend::Multiply,
        pressure: false,
        recipe: PenRecipe::Pf1 {
            thinning: 0.0,
            taper_start: 0.0,
            taper_end: 0.0,
            caps: false,
            smoothing: None,
            streamline: None,
        },
        ..pf1("highlighter", 16.0, 0.0, 0.0, 0.0)
    },
];

/// La penna di sistema `id`. Gli id sono in minuscolo, come in `pens.ts`:
/// `Ballpoint` non è una penna.
pub fn pen(id: &str) -> Option<&'static PenSpec> {
    PENS.iter().find(|pen| pen.id == id)
}

/// La misura `size` stretta fra [`MIN_PEN_SIZE`] e [`MAX_PEN_SIZE`], come la
/// stringono i menu della GUI. Un numero che non c'è (`NaN`) vale la misura di
/// serie della penna.
pub fn clamp_size(pen: &PenSpec, size: f64) -> f64 {
    if size.is_nan() {
        pen.size
    } else {
        size.clamp(MIN_PEN_SIZE, MAX_PEN_SIZE)
    }
}

/// Il pennello della penna `pen` di misura `size`, per un tratto nato con o
/// senza la pressione del dispositivo. Dentro l'intervallo delle misure è lo
/// stesso di `penBrush` di `pens.ts`; `penBrush` invece non stringe la misura,
/// qui una misura fuori dall'intervallo si stringe con [`clamp_size`], come
/// fanno i menu della GUI, e `NaN` vale la misura di serie. Senza pressione una penna
/// che la segue la simula (`sim=1`); una penna che non la segue non la finge
/// nemmeno, e il suo `sim` resta 0.
pub fn pen_brush(pen: &PenSpec, size: f64, pressure: bool) -> InkBrush {
    let size = clamp_size(pen, size);
    let follows = |sim: bool| sim || (pen.pressure && !pressure);
    let unknown = vec![(PEN_KEY.to_owned(), pen.id.to_owned())];
    match pen.recipe {
        PenRecipe::Pf1 {
            thinning,
            taper_start,
            taper_end,
            caps,
            smoothing,
            streamline,
        } => {
            let defaults = Brush::default();
            InkBrush::Pf1(Brush {
                size,
                thinning,
                smoothing: smoothing.unwrap_or(defaults.smoothing),
                streamline: streamline.unwrap_or(defaults.streamline),
                taper_start: taper_start * size,
                taper_end: taper_end * size,
                cap_start: caps,
                cap_end: caps,
                sim: follows(false),
                unknown,
            })
        }
        PenRecipe::Nib1 => {
            let defaults = Nib1Brush::default();
            InkBrush::Nib1(Nib1Brush {
                size,
                tip: defaults.tip.min(size),
                sim: follows(defaults.sim),
                unknown,
                ..defaults
            })
        }
    }
}

/// Un colore della tavolozza dell'inchiostro.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InkSwatch {
    /// Il nome del colore, in minuscolo: è un id, che chi lo mostra traduce.
    pub id: &'static str,
    /// `#rrggbb` minuscolo, come lo scrive un file.
    pub color: &'static str,
}

/// Gli otto colori di Okabe–Ito, nell'ordine della tavolozza di `palette.ts`.
pub const INK_PALETTE: [InkSwatch; 8] = [
    InkSwatch {
        id: "black",
        color: "#000000",
    },
    InkSwatch {
        id: "blue",
        color: "#0072b2",
    },
    InkSwatch {
        id: "vermilion",
        color: "#d55e00",
    },
    InkSwatch {
        id: "green",
        color: "#009e73",
    },
    InkSwatch {
        id: "purple",
        color: "#cc79a7",
    },
    InkSwatch {
        id: "orange",
        color: "#e69f00",
    },
    InkSwatch {
        id: "sky",
        color: "#56b4e9",
    },
    InkSwatch {
        id: "yellow",
        color: "#f0e442",
    },
];

/// Il colore della tavolozza col nome `name`. I nomi sono in minuscolo: `Blue`
/// non è un colore.
pub fn ink_color(name: &str) -> Option<&'static str> {
    INK_PALETTE
        .iter()
        .find(|swatch| swatch.id == name)
        .map(|swatch| swatch.color)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ballpoint() -> &'static PenSpec {
        pen("ballpoint").expect("la penna c'è")
    }

    #[test]
    fn gli_id_sono_sette_e_distinti_e_la_penna_di_serie_c_e() {
        let ids: Vec<&str> = PENS.iter().map(|pen| pen.id).collect();
        assert_eq!(
            ids,
            [
                "ballpoint",
                "fountain",
                "brush",
                "marker",
                "pencil",
                "calligraphy",
                "highlighter"
            ]
        );
        assert!(pen(DEFAULT_PEN).is_some());
        assert!(pen("Ballpoint").is_none());
        assert!(pen("").is_none());
    }

    #[test]
    fn una_misura_fuori_dall_intervallo_si_stringe() {
        let pen = ballpoint();
        assert_eq!(
            pen_brush(pen, 0.01, true),
            pen_brush(pen, MIN_PEN_SIZE, true)
        );
        assert_eq!(
            pen_brush(pen, -3.0, true),
            pen_brush(pen, MIN_PEN_SIZE, true)
        );
        assert_eq!(
            pen_brush(pen, 500.0, true),
            pen_brush(pen, MAX_PEN_SIZE, true)
        );
        assert_eq!(
            pen_brush(pen, f64::INFINITY, true),
            pen_brush(pen, MAX_PEN_SIZE, true)
        );
        assert_eq!(
            pen_brush(pen, f64::NAN, true),
            pen_brush(pen, pen.size, true)
        );
    }

    /// La misura scritta nel pennello, per le due ricette.
    fn written_size(brush: &InkBrush) -> f64 {
        match brush {
            InkBrush::Pf1(brush) => brush.size,
            InkBrush::Nib1(brush) => brush.size,
        }
    }

    #[test]
    fn ogni_penna_stringe_la_misura_e_nan_vale_quella_di_serie() {
        for pen in &PENS {
            for pressure in [true, false] {
                let id = pen.id;
                let low = written_size(&pen_brush(pen, 0.0, pressure));
                let high = written_size(&pen_brush(pen, 1e9, pressure));
                let nan = written_size(&pen_brush(pen, f64::NAN, pressure));
                assert_eq!(low, MIN_PEN_SIZE, "{id}: sotto l'intervallo");
                assert_eq!(high, MAX_PEN_SIZE, "{id}: sopra l'intervallo");
                assert_eq!(nan, pen.size, "{id}: NaN");
                assert!(pen_brush(pen, f64::NAN, pressure).encode().is_ok(), "{id}");
            }
        }
    }

    #[test]
    fn le_rastremazioni_sono_multipli_della_misura() {
        let InkBrush::Pf1(brush) = pen_brush(ballpoint(), 3.0, true) else {
            panic!("la Biro è pf1");
        };
        assert_eq!((brush.taper_start, brush.taper_end), (3.0, 12.0));
        assert_eq!(brush.unknown, [("pen".to_owned(), "ballpoint".to_owned())]);
    }

    #[test]
    fn la_calligrafia_non_ha_la_punta_piu_larga_della_misura() {
        let calligraphy = pen("calligraphy").expect("la penna c'è");
        let InkBrush::Nib1(small) = pen_brush(calligraphy, 0.25, true) else {
            panic!("la Calligrafia è nib1");
        };
        assert_eq!(small.tip, 0.25);
        let InkBrush::Nib1(big) = pen_brush(calligraphy, 12.0, true) else {
            panic!("la Calligrafia è nib1");
        };
        assert_eq!(big.tip, Nib1Brush::default().tip);
    }

    #[test]
    fn senza_pressione_la_simula_solo_chi_la_segue() {
        for pen in &PENS {
            let sim = match pen_brush(pen, pen.size, false) {
                InkBrush::Pf1(brush) => brush.sim,
                InkBrush::Nib1(brush) => brush.sim,
            };
            assert_eq!(sim, pen.pressure, "{}", pen.id);
            let with = match pen_brush(pen, pen.size, true) {
                InkBrush::Pf1(brush) => brush.sim,
                InkBrush::Nib1(brush) => brush.sim,
            };
            assert!(!with, "{}", pen.id);
        }
    }

    #[test]
    fn ogni_pennello_si_scrive_e_si_rilegge_uguale() {
        for pen in &PENS {
            for size in [MIN_PEN_SIZE, 1.0, pen.size, 7.3, MAX_PEN_SIZE] {
                for pressure in [true, false] {
                    let brush = pen_brush(pen, size, pressure);
                    let text = brush.encode().expect("il pennello di una penna si scrive");
                    assert_eq!(InkBrush::parse(&text), Ok(brush), "{text}");
                }
            }
        }
    }

    #[test]
    fn i_colori_si_chiamano_in_minuscolo() {
        assert_eq!(ink_color("blue"), Some("#0072b2"));
        assert_eq!(ink_color("Blue"), None);
        assert_eq!(ink_color("BLUE"), None);
        assert_eq!(ink_color("#0072b2"), None);
        assert_eq!(ink_color(""), None);
        for swatch in &INK_PALETTE {
            assert_eq!(swatch.id, swatch.id.to_lowercase());
            assert_eq!(swatch.color, swatch.color.to_lowercase());
        }
    }
}
