//! Descrivere un carattere: le facce di un file, i loro assi, le posizioni
//! con nome e la famiglia generica che la forma dei glifi suggerisce.

use std::sync::Arc;

use kurbo::{BezPath, Line, ParamCurve, Shape};
use resvg::usvg::fontdb;
use serde::{Deserialize, Serialize};
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::DrawSettings;
use skrifa::raw::{FontRef, TableProvider};
use skrifa::MetadataProvider;

use super::instance::Contours;
use super::{damaged, same_family, FontError, RESERVED};

// --- descrivere --------------------------------------------------------------

/// Lo stile di una faccia, come lo dicono i CSS.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Style {
    Normal,
    Italic,
    Oblique,
}

/// La famiglia generica a cui una faccia somiglia: è quella che un disegno
/// scrive dopo la famiglia, e quella che si usa dove la famiglia manca.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Generic {
    Serif,
    SansSerif,
    Monospace,
    Cursive,
    Fantasy,
}

/// Un asse di un carattere variabile, nei valori del file (`fvar`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Axis {
    pub tag: String,
    pub min: f64,
    pub default: f64,
    pub max: f64,
}

/// Un punto su un asse.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Coordinate {
    pub tag: String,
    pub value: f64,
}

/// Uno stile che una faccia sa dare, con i punti degli assi che lo danno: un
/// carattere variabile con l'asse `ital` dà il tondo con `ital` a 0 e il
/// corsivo con `ital` a 1.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Slot {
    pub style: Style,
    pub fixed: Vec<Coordinate>,
}

/// Una faccia di un file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Face {
    /// La posizione della faccia nel file: 0, se il file non è una collezione.
    pub index: u32,
    /// Il nome della famiglia in inglese, quello del menu.
    pub family: String,
    /// Tutti i nomi della famiglia, in ogni lingua del file: un disegno la può
    /// chiamare con uno qualunque.
    pub names: Vec<String>,
    pub generic: Generic,
    /// I pesi che dà, da… a: un peso solo per una faccia statica, l'asse `wght`
    /// per una variabile.
    pub weight: [f64; 2],
    /// Le larghezze che dà, in percentuale, come `font-stretch`.
    pub stretch: [f64; 2],
    pub styles: Vec<Slot>,
    /// Gli assi; nessuno per una faccia statica.
    pub axes: Vec<Axis>,
}

impl Face {
    /// Se la famiglia `name` è questa ([`same_family`]).
    pub(crate) fn is_called(&self, name: &str) -> bool {
        self.names.iter().any(|each| same_family(each, name))
    }

    /// Se il nome è di una famiglia di Fub, che vince.
    pub(crate) fn is_reserved(&self) -> bool {
        RESERVED.iter().any(|name| self.is_called(name))
    }
}

/// Se la licenza della faccia `index` lascia incorporarla in un documento,
/// come la incorpora un PDF: in parte, con i soli glifi che usa, e coi suoi
/// tracciati. Lo dice `fsType` della tabella OS/2 (OpenType 1.9): non la
/// lascia l'uso «riservato» da solo (`0x0002`; con un altro bit vale quello
/// che concede di più), né il divieto di incorporarne una parte (`0x0100`), né
/// l'incorporazione soltanto delle bitmap (`0x0200`). Una faccia senza OS/2 non
/// pone limiti.
pub(crate) fn embeddable(sfnt: &[u8], index: u32) -> bool {
    let Ok(font) = FontRef::from_index(sfnt, index) else {
        return true;
    };
    let Ok(os2) = font.os2() else {
        return true;
    };
    let fs_type = os2.fs_type();
    fs_type & 0x000F != 0x0002 && fs_type & 0x0300 == 0
}

/// Le facce di un carattere già decodificato ([`decode`]).
pub(crate) fn describe(sfnt: &[u8]) -> Result<Vec<Face>, FontError> {
    let mut db = fontdb::Database::new();
    db.load_font_source(fontdb::Source::Binary(Arc::new(sfnt.to_vec())));
    let mut faces = Vec::new();
    for info in db.faces() {
        let Some((family, _)) = info.families.first() else {
            continue;
        };
        let font = FontRef::from_index(sfnt, info.index).map_err(damaged)?;
        let mut names: Vec<String> = Vec::new();
        for (name, _) in &info.families {
            if !names.contains(name) {
                names.push(name.clone());
            }
        }
        let axes: Vec<Axis> = font
            .axes()
            .iter()
            .map(|axis| Axis {
                tag: axis.tag().to_string(),
                min: f64::from(axis.min_value()),
                default: f64::from(axis.default_value()),
                max: f64::from(axis.max_value()),
            })
            .collect();
        let weight = f64::from(info.weight.0);
        let stretch = WIDTHS[usize::from(info.stretch.to_number().clamp(1, 9)) - 1];
        let range = |tag: &str, fixed: f64| {
            axes.iter()
                .find(|axis| axis.tag == tag)
                .map_or([fixed, fixed], |axis| [axis.min, axis.max])
        };
        let style = match info.style {
            fontdb::Style::Normal => Style::Normal,
            fontdb::Style::Italic => Style::Italic,
            fontdb::Style::Oblique => Style::Oblique,
        };
        faces.push(Face {
            index: info.index,
            family: family.clone(),
            names,
            generic: generic(&font, family, info.monospaced),
            weight: range("wght", weight),
            stretch: range("wdth", stretch),
            styles: slots(&axes, style),
            axes,
        });
    }
    if faces.is_empty() {
        return Err(damaged("no readable face"));
    }
    faces.sort_by_key(|face| face.index);
    Ok(faces)
}

/// Le larghezze dei nove gradi di `usWidthClass`, in percentuale.
pub(super) const WIDTHS: [f64; 9] = [50.0, 62.5, 75.0, 87.5, 100.0, 112.5, 125.0, 150.0, 200.0];

/// L'angolo di un obliquo che non dice il suo, come per i CSS.
const OBLIQUE: f64 = 14.0;

/// Gli stili di una faccia. Con l'asse `ital` il tondo e il corsivo; con
/// l'asse `slnt`, che inclina verso destra coi valori negativi, il tondo se
/// lo zero c'è e l'obliquo a 14 gradi, o all'inclinazione più vicina; senza,
/// lo stile del file.
fn slots(axes: &[Axis], style: Style) -> Vec<Slot> {
    let fixed = |tag: &str, value: f64| {
        vec![Coordinate {
            tag: tag.to_string(),
            value,
        }]
    };
    let ital = axes.iter().find(|axis| axis.tag == "ital");
    let slnt = axes.iter().find(|axis| axis.tag == "slnt");
    if ital.is_some_and(|axis| axis.min <= 0.0 && axis.max >= 1.0) {
        return vec![
            Slot {
                style: Style::Normal,
                fixed: fixed("ital", 0.0),
            },
            Slot {
                style: Style::Italic,
                fixed: fixed("ital", 1.0),
            },
        ];
    }
    if let Some(slnt) = slnt.filter(|axis| axis.min < 0.0) {
        let mut slots = Vec::new();
        if slnt.min <= 0.0 && slnt.max >= 0.0 && style == Style::Normal {
            slots.push(Slot {
                style: Style::Normal,
                fixed: fixed("slnt", 0.0),
            });
        }
        slots.push(Slot {
            style: if style == Style::Italic {
                Style::Italic
            } else {
                Style::Oblique
            },
            fixed: fixed("slnt", (-OBLIQUE).clamp(slnt.min, slnt.max.min(0.0))),
        });
        return slots;
    }
    vec![Slot {
        style,
        fixed: Vec::new(),
    }]
}

/// La famiglia generica di una faccia, dal segno più sicuro al meno sicuro:
/// monospaziata se il file lo dice (`post`, o la proporzione del PANOSE); poi
/// le parole del nome, che il disegnatore sceglie apposta («Sans», «Serif»,
/// «Mono», «Script»…); poi il PANOSE e la classe della famiglia di `OS/2`,
/// che molti caratteri recenti lasciano a zero; poi la forma della «I» e
/// della «H»; se no senza grazie.
fn generic(font: &FontRef, family: &str, monospaced: bool) -> Generic {
    let os2 = font.os2().ok();
    let panose = os2.as_ref().map(|os2| os2.panose_10()).unwrap_or_default();
    if monospaced || (panose.first() == Some(&2) && panose.get(3) == Some(&9)) {
        return Generic::Monospace;
    }
    by_name(family)
        .or_else(|| {
            os2.as_ref()
                .and_then(|os2| by_panose(panose, os2.s_family_class()))
        })
        .or_else(|| by_shape(font))
        .unwrap_or(Generic::SansSerif)
}

/// La famiglia generica che dicono le parole del nome, in quest'ordine:
/// «Noto Sans Mono» è monospaziato, «Microsoft Sans Serif» senza grazie.
pub(super) fn by_name(family: &str) -> Option<Generic> {
    const WORDS: [(&[&str], Generic); 4] = [
        (
            &["mono", "monospace", "monospaced", "code"],
            Generic::Monospace,
        ),
        (
            &["sans", "grotesk", "grotesque", "gothic"],
            Generic::SansSerif,
        ),
        (&["serif", "slab", "antiqua", "mincho"], Generic::Serif),
        (&["script", "hand", "handwriting"], Generic::Cursive),
    ];
    let words: Vec<&str> = family.split(|c: char| !c.is_alphanumeric()).collect();
    WORDS
        .iter()
        .find(|(names, _)| {
            words
                .iter()
                .any(|word| names.iter().any(|name| same_family(word, name)))
        })
        .map(|(_, generic)| *generic)
}

/// La famiglia generica del PANOSE, e se non lo dice della classe di `OS/2`.
pub(super) fn by_panose(panose: &[u8], class: i16) -> Option<Generic> {
    let by_class = || match class >> 8 {
        1..=5 | 7 => Some(Generic::Serif),
        8 => Some(Generic::SansSerif),
        9 => Some(Generic::Fantasy),
        10 => Some(Generic::Cursive),
        _ => None,
    };
    match panose.first() {
        Some(2) => match panose.get(1) {
            Some(2..=10) => Some(Generic::Serif),
            Some(11..=15) => Some(Generic::SansSerif),
            _ => by_class(),
        },
        Some(3) => Some(Generic::Cursive),
        Some(4) => Some(Generic::Fantasy),
        _ => by_class(),
    }
}

/// Le grazie dalla forma delle lettere: con le grazie, i piedi o la testa di
/// una lettera coprono molto più delle sue aste a un quarto dell'altezza,
/// sotto la traversa della «H»; un corsivo senza grazie è inclinato ma largo
/// uguale a ogni altezza. Conta soltanto se la «I» e la «H», quando ci sono
/// tutte e due, dicono la stessa cosa.
pub(super) fn by_shape(font: &FontRef) -> Option<Generic> {
    let charmap = font.charmap();
    let outlines = font.outline_glyphs();
    let mut verdicts = ['I', 'H'].into_iter().filter_map(|letter| {
        let glyph = outlines.get(charmap.map(letter)?)?;
        let mut pen = Contours::default();
        let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
        glyph.draw(settings, &mut pen).ok()?;
        let path = pen.finish();
        let bounds = path.bounding_box();
        let edge = (bounds.height() * 0.015).max(1.0);
        let stems = covered(&path, bounds.y0 + bounds.height() * 0.25);
        let ends = covered(&path, bounds.y0 + edge).max(covered(&path, bounds.y1 - edge));
        (stems > 0.0).then(|| ends / stems > 1.6)
    });
    let first = verdicts.next()?;
    if verdicts.next().is_some_and(|second| second != first) {
        return None;
    }
    Some(if first {
        Generic::Serif
    } else {
        Generic::SansSerif
    })
}

/// Quanto copre un contorno lungo l'orizzontale all'altezza `y`.
fn covered(path: &BezPath, y: f64) -> f64 {
    let bounds = path.bounding_box();
    let line = Line::new((bounds.x0 - 1.0, y), (bounds.x1 + 1.0, y));
    let mut xs: Vec<f64> = path
        .segments()
        .flat_map(|segment| segment.intersect_line(line))
        .map(|hit| line.eval(hit.line_t).x)
        .collect();
    xs.sort_by(f64::total_cmp);
    xs.chunks_exact(2).map(|pair| pair[1] - pair[0]).sum()
}
