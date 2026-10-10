//! I caratteri del vault.
//!
//! Un file `.ttf`, `.otf`, `.ttc`, `.otc`, `.woff` o `.woff2` del vault è un
//! carattere che un disegno può usare. Questo modulo ne è l'unica autorità,
//! per la superficie dell'editor, che lo interroga dall'indice `fub.draw`, e
//! per l'export, che lo chiama direttamente:
//!
//! - [`decode`] toglie la compressione del WOFF e del WOFF2 e dà i byte del
//!   carattere, con un tetto alla misura;
//! - [`describe`] dice che facce ha un file: la famiglia, il peso, lo stile,
//!   la larghezza, gli assi di un carattere variabile e la famiglia generica
//!   di ripiego. I nomi e le misure li legge `fontdb`, lo stesso che sceglie i
//!   caratteri dell'export, quindi sono quelli che l'export riconosce;
//! - [`choose`] sceglie la faccia di una famiglia per un peso, uno stile e una
//!   larghezza, con le regole di scelta dei CSS, e dice in che punto degli assi
//!   va fissata;
//! - [`instance`] fissa una faccia in quel punto e ne fa un carattere statico,
//!   un file solo con una faccia sola.
//!
//! # Perché un carattere statico
//!
//! Un carattere variabile disegna ogni peso fra il più leggero e il più nero,
//! e ogni larghezza o grandezza ottica che i suoi assi dicono. Il browser
//! sceglie il punto da sé: il peso dal `font-weight`, la grandezza ottica dal
//! corpo del testo. `usvg` 0.45 invece non sa scegliere un punto, e disegna il
//! punto di serie del file. Lo stesso testo uscirebbe in due modi.
//!
//! Così il punto lo sceglie [`choose`], una volta e per tutti e due, e
//! [`instance`] ne fa un carattere che ha soltanto quel punto: i contorni
//! ridisegnati lì da `skrifa` e scritti da `write-fonts`, le larghezze dei
//! glifi, le metriche (`MVAR`), la crenatura e gli attacchi dei segni (le
//! variazioni del `GPOS`) e le sostituzioni che dipendono dal punto (le
//! `FeatureVariations`). Gli assi se ne vanno, e con loro le tabelle delle
//! variazioni. La superficie registra quel file in una `FontFace` e l'export
//! lo dà a `usvg`: sono gli stessi byte, e il browser non ha un asse da
//! muovere né un peso da inventare. La grandezza ottica resta quella di serie
//! del file: un'istanza per ogni corpo sarebbe un carattere per ogni testo.
//!
//! I contorni nuovi sono semplici e senza istruzioni di hinting (le
//! istruzioni valgono per i contorni di serie, e né `resvg` né la webview le
//! usano): un glifo composto diventa un glifo semplice con i contorni dei suoi
//! pezzi, e una curva cubica di un CFF2 diventa una catena di quadratiche entro
//! un quarantesimo di unità.
//!
//! # Un file del vault è un dato
//!
//! Un carattere viene da chiunque abbia scritto nel vault, quindi si legge
//! come un dato qualunque: un file più grande di [`MAX_FONT_BYTES`] non si
//! legge, la decompressione di un WOFF si ferma allo stesso tetto prima di
//! allocare, e un carattere che non si legge è un errore, mai un panico.

use std::borrow::Cow;
use std::cmp::Ordering;
use std::fmt;
use std::sync::Arc;

use kurbo::{BezPath, CubicBez, Line, ParamCurve, PathEl, Shape};
use resvg::usvg::fontdb;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use skrifa::instance::{Location, LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::tables::gdef::Gdef;
use skrifa::raw::tables::name::NameRecord;
use skrifa::raw::tables::variations::{DeltaSetIndex, ItemVariationStore};
use skrifa::raw::types::{BigEndian, F2Dot14, Fixed, NameId};
use skrifa::raw::{FontRef, TableProvider};
use skrifa::{GlyphId, MetadataProvider, Tag};
use write_fonts::from_obj::ToOwnedTable;
use write_fonts::tables::glyf::{Bbox, GlyfLocaBuilder, Glyph, SimpleGlyph};
use write_fonts::tables::gpos::{
    AnchorTable, ExtensionSubtable, Gpos, PairPos, PositionLookup, SinglePos, ValueFormat,
    ValueRecord,
};
use write_fonts::tables::gsub::Gsub;
use write_fonts::tables::hmtx::{Hmtx, LongMetric};
use write_fonts::tables::layout::{
    Condition, DeviceOrVariationIndex, FeatureList, FeatureVariations,
};
use write_fonts::tables::loca::LocaFormat;
use write_fonts::tables::name::{Name, NameRecord as OwnedNameRecord};
use write_fonts::{dump_table, FontBuilder, NullableOffsetMarker};

use super::{MONO, SANS, SERIF};

/// Il file più grande che si legge, e il carattere più grande che un WOFF o un
/// WOFF2 può diventare: un carattere CJK con tutti i suoi glifi ci sta.
pub(crate) const MAX_FONT_BYTES: usize = 64 * 1024 * 1024;

/// Le famiglie di Fub. Una faccia del vault con uno di questi nomi non conta:
/// il nome è già del carattere che l'app distribuisce, e quel carattere vince.
const RESERVED: [&str; 3] = [SANS, SERIF, MONO];

/// Se due nomi sono la stessa famiglia: come nei browser, senza badare a
/// maiuscole e minuscole, ma soltanto nell'ASCII (la risoluzione del CSSWG del
/// 2019 sui nomi di famiglia). È il confronto di tutti i nomi di famiglia di
/// questo modulo e dell'export, e quello del client.
pub(crate) fn same_family(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// La famiglia di Fub che `name` nomina, scritta come la scrive Fub.
pub(crate) fn reserved(name: &str) -> Option<&'static str> {
    RESERVED.into_iter().find(|fub| same_family(fub, name))
}

/// Perché un file non dà un carattere.
#[derive(Debug, PartialEq)]
pub(crate) enum FontError {
    /// Non comincia come un carattere, una collezione, un WOFF o un WOFF2.
    NotAFont,
    /// Il file, o il carattere che il WOFF promette, passa [`MAX_FONT_BYTES`].
    TooLarge,
    /// Comincia come un carattere, ma non si legge.
    Damaged(String),
    /// La faccia chiesta non c'è.
    NoFace(u32),
}

impl fmt::Display for FontError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FontError::NotAFont => f.write_str("not a font file"),
            FontError::TooLarge => write!(f, "font larger than {} MiB", MAX_FONT_BYTES >> 20),
            FontError::Damaged(reason) => write!(f, "damaged font: {reason}"),
            FontError::NoFace(index) => write!(f, "the font has no face {index}"),
        }
    }
}

fn damaged(error: impl fmt::Display) -> FontError {
    FontError::Damaged(error.to_string())
}

// --- decodificare ------------------------------------------------------------

/// I byte del carattere di un file: un TrueType, un OpenType o una collezione
/// così come sono, un WOFF o un WOFF2 decompresso.
pub(crate) fn decode(bytes: &[u8]) -> Result<Cow<'_, [u8]>, FontError> {
    if bytes.len() > MAX_FONT_BYTES {
        return Err(FontError::TooLarge);
    }
    match bytes.get(..4) {
        Some(b"\0\x01\0\0" | b"true" | b"OTTO" | b"ttcf") => Ok(Cow::Borrowed(bytes)),
        Some(b"wOFF") => {
            promised(bytes)?;
            // Lo zlib di ogni tabella scrive al più quanto la tabella dichiara,
            // e la somma delle dichiarazioni non passa il tetto: un WOFF che
            // promette poco e si gonfia si ferma prima di allocare.
            let mut left = MAX_FONT_BYTES;
            let mut inflate = |data: &[u8], size: usize| {
                if size > left {
                    return Err(Box::<dyn std::error::Error>::from(
                        FontError::TooLarge.to_string(),
                    ));
                }
                left -= size;
                let mut out = Vec::with_capacity(size);
                flate2::Decompress::new(true).decompress_vec(
                    data,
                    &mut out,
                    flate2::FlushDecompress::Finish,
                )?;
                Ok(out)
            };
            wuff::decompress_woff1_with_custom_z(bytes, &mut inflate)
                .map(Cow::Owned)
                .map_err(damaged)
        }
        Some(b"wOF2") => {
            promised(bytes)?;
            let sfnt = wuff::decompress_woff2(bytes).map_err(damaged)?;
            if sfnt.len() > MAX_FONT_BYTES {
                return Err(FontError::TooLarge);
            }
            Ok(Cow::Owned(sfnt))
        }
        _ => Err(FontError::NotAFont),
    }
}

/// Il carattere che un WOFF o un WOFF2 promette (`totalSfntSize`, a 16 byte
/// dall'inizio in tutti e due), che non passa il tetto.
fn promised(bytes: &[u8]) -> Result<(), FontError> {
    let size = bytes
        .get(16..20)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or_else(|| damaged("truncated header"))?;
    if size > MAX_FONT_BYTES {
        return Err(FontError::TooLarge);
    }
    Ok(())
}

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
const WIDTHS: [f64; 9] = [50.0, 62.5, 75.0, 87.5, 100.0, 112.5, 125.0, 150.0, 200.0];

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
fn by_name(family: &str) -> Option<Generic> {
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
fn by_panose(panose: &[u8], class: i16) -> Option<Generic> {
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
fn by_shape(font: &FontRef) -> Option<Generic> {
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

// --- scegliere ---------------------------------------------------------------

/// Che faccia si cerca: il peso da 1 a 1000, lo stile e la larghezza in
/// percentuale.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub(crate) struct Request {
    pub weight: f64,
    pub style: Style,
    pub stretch: f64,
}

impl Request {
    /// Il tondo normale: è la faccia che dice la famiglia generica.
    pub(crate) const REGULAR: Request = Request {
        weight: 400.0,
        style: Style::Normal,
        stretch: 100.0,
    };
}

/// La faccia scelta: il file, la faccia nel file e i punti degli assi.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Choice {
    pub file: usize,
    pub face: usize,
    pub coordinates: Vec<Coordinate>,
}

/// Una faccia possibile: una faccia con uno dei suoi stili.
struct Candidate<'f> {
    file: usize,
    face: usize,
    item: &'f Face,
    slot: &'f Slot,
}

/// Sceglie fra le facce di `files`, nell'ordine dato, quella della famiglia
/// `family` che i CSS sceglierebbero per `request` (CSS Fonts 4, §5.2): prima
/// la larghezza, poi lo stile, poi il peso, con un carattere variabile che
/// vale per tutto l'intervallo dei suoi assi. A pari merito vince una faccia
/// statica, poi l'ordine dei file e delle facce. Le famiglie di Fub non si
/// scelgono qui. Il client fa la stessa scelta, e i vettori di
/// `__fixtures__/scene-fonts/choose.json` provano tutti e due.
pub(crate) fn choose(files: &[&[Face]], family: &str, request: &Request) -> Option<Choice> {
    pick(files, family, request, false)
}

/// La stessa scelta fra i caratteri di Fub, per l'export.
pub(crate) fn choose_reserved(
    files: &[&[Face]],
    family: &str,
    request: &Request,
) -> Option<Choice> {
    pick(files, family, request, true)
}

fn pick(files: &[&[Face]], family: &str, request: &Request, reserved: bool) -> Option<Choice> {
    let mut candidates: Vec<Candidate> = Vec::new();
    for (file, faces) in files.iter().enumerate() {
        for (face, item) in faces.iter().enumerate() {
            if !item.is_called(family) || item.is_reserved() != reserved {
                continue;
            }
            for slot in &item.styles {
                candidates.push(Candidate {
                    file,
                    face,
                    item,
                    slot,
                });
            }
        }
    }
    keep_best(&mut candidates, |each| {
        stretch_key(each.item.stretch, request.stretch)
    });
    keep_best(&mut candidates, |each| {
        (style_rank(each.slot.style, request.style), 0.0)
    });
    keep_best(&mut candidates, |each| {
        weight_key(each.item.weight, request.weight)
    });
    let best = candidates
        .iter()
        .find(|each| each.item.axes.is_empty())
        .or_else(|| candidates.first())?;
    let mut coordinates = Vec::new();
    for axis in &best.item.axes {
        let value = match axis.tag.as_str() {
            "wght" => Some(request.weight.clamp(axis.min, axis.max)),
            "wdth" => Some(request.stretch.clamp(axis.min, axis.max)),
            tag => best
                .slot
                .fixed
                .iter()
                .find(|each| each.tag == tag)
                .map(|each| each.value),
        };
        if let Some(value) = value {
            coordinates.push(Coordinate {
                tag: axis.tag.clone(),
                value,
            });
        }
    }
    Some(Choice {
        file: best.file,
        face: best.face,
        coordinates,
    })
}

/// La famiglia generica di una famiglia del vault: quella del suo tondo
/// normale, o della faccia che lo sostituisce. È la regola con cui il client
/// scrive la famiglia generica dopo quella del vault; l'export la legge dal
/// testo, e qui la provano i vettori condivisi.
#[cfg(test)]
pub(crate) fn family_generic(files: &[&[Face]], family: &str) -> Option<Generic> {
    let choice = choose(files, family, &Request::REGULAR)?;
    Some(files[choice.file][choice.face].generic)
}

/// Tiene i candidati con la chiave più piccola, nell'ordine in cui erano.
fn keep_best<'f>(candidates: &mut Vec<Candidate<'f>>, key: impl Fn(&Candidate<'f>) -> (u8, f64)) {
    let Some(best) = candidates.iter().map(&key).min_by(compare) else {
        return;
    };
    candidates.retain(|each| compare(&key(each), &best) == Ordering::Equal);
}

fn compare(a: &(u8, f64), b: &(u8, f64)) -> Ordering {
    a.0.cmp(&b.0).then(a.1.total_cmp(&b.1))
}

/// Quanto un intervallo di larghezze è lontano da quella chiesta: fino al 100%
/// prima le più strette, dalla più vicina, poi le più larghe; oltre, il
/// contrario.
fn stretch_key([low, high]: [f64; 2], wanted: f64) -> (u8, f64) {
    if low <= wanted && wanted <= high {
        (0, 0.0)
    } else if wanted <= 100.0 {
        if high < wanted {
            (1, wanted - high)
        } else {
            (2, low - wanted)
        }
    } else if low > wanted {
        (1, low - wanted)
    } else {
        (2, wanted - high)
    }
}

/// Quanto uno stile è lontano da quello chiesto: il corsivo cerca il corsivo,
/// poi l'obliquo, poi il tondo; il tondo il tondo, poi l'obliquo, poi il
/// corsivo; l'obliquo l'obliquo, poi il corsivo, poi il tondo.
fn style_rank(style: Style, wanted: Style) -> u8 {
    let order = match wanted {
        Style::Italic => [Style::Italic, Style::Oblique, Style::Normal],
        Style::Normal => [Style::Normal, Style::Oblique, Style::Italic],
        Style::Oblique => [Style::Oblique, Style::Italic, Style::Normal],
    };
    order.iter().position(|each| *each == style).unwrap_or(3) as u8
}

/// Quanto un intervallo di pesi è lontano da quello chiesto: fra 400 e 500
/// prima i più neri fino a 500, poi i più chiari, poi i più neri oltre 500;
/// sotto 400 prima i più chiari; sopra 500 prima i più neri.
fn weight_key([low, high]: [f64; 2], wanted: f64) -> (u8, f64) {
    if low <= wanted && wanted <= high {
        (0, 0.0)
    } else if (400.0..=500.0).contains(&wanted) {
        if low > wanted && low <= 500.0 {
            (1, low - wanted)
        } else if high < wanted {
            (2, wanted - high)
        } else {
            (3, low - wanted)
        }
    } else if wanted < 400.0 {
        if high < wanted {
            (1, wanted - high)
        } else {
            (2, low - wanted)
        }
    } else if low > wanted {
        (1, low - wanted)
    } else {
        (2, wanted - high)
    }
}

// --- istanziare --------------------------------------------------------------

/// Le tabelle che un'istanza non porta: gli assi e le variazioni, la firma,
/// che non varrebbe più, e il `CFF2`, che diventa `glyf`.
const VARIATIONS: [&[u8; 4]; 11] = [
    b"fvar", b"gvar", b"avar", b"cvar", b"HVAR", b"VVAR", b"MVAR", b"STAT", b"DSIG", b"CFF2",
    b"VARC",
];

/// Le tabelle che valgono per i contorni di serie e non per quelli ridisegnati:
/// le istruzioni di hinting e le misure dei glifi in pixel.
const HINTING: [&[u8; 4]; 6] = [b"cvt ", b"fpgm", b"prep", b"hdmx", b"LTSH", b"VDMX"];

/// La faccia `index` di un carattere decodificato fissata nei punti
/// `coordinates`, in un file con una faccia sola. Una faccia statica esce
/// com'è (tolta dalla collezione, se lo era); una variabile perde gli assi.
/// I punti fuori da un asse si fermano al suo bordo, e un asse senza punto
/// resta al suo valore di serie.
pub(crate) fn instance(
    sfnt: &[u8],
    index: u32,
    coordinates: &[Coordinate],
) -> Result<Vec<u8>, FontError> {
    let font = face_of(sfnt, index)?;
    if font.axes().is_empty() {
        return Ok(extract(sfnt, &font));
    }
    let axes = font.axes();
    let location = axes.location(
        coordinates
            .iter()
            .filter_map(|each| Some((tag_of(&each.tag)?, each.value as f32))),
    );
    let user = |tag: &str| -> Option<f64> {
        let axis = axes.get_by_tag(tag_of(tag)?)?;
        let value = coordinates
            .iter()
            .rev()
            .find(|each| each.tag == tag)
            .map_or(f64::from(axis.default_value()), |each| each.value);
        Some(value.clamp(f64::from(axis.min_value()), f64::from(axis.max_value())))
    };
    let coords = location.coords();
    let default = LocationRef::from(&location).is_default();
    let has = |tag: &[u8; 4]| font.data_for_tag(Tag::new(tag)).is_some();
    let cff2 = has(b"CFF2");
    let redraw = cff2 || (has(b"glyf") && has(b"gvar") && !default);

    let mut out = FontBuilder::new();
    let mut head = table(&font, b"head")?;
    let mut hhea = table(&font, b"hhea")?;
    let mut os2 = font
        .data_for_tag(Tag::new(b"OS/2"))
        .map(|d| d.as_bytes().to_vec());
    let mut post = font
        .data_for_tag(Tag::new(b"post"))
        .map(|d| d.as_bytes().to_vec());
    let mut vhea = font
        .data_for_tag(Tag::new(b"vhea"))
        .map(|d| d.as_bytes().to_vec());

    if redraw {
        let outlines = redraw_outlines(&font, &location)?;
        put_i16(&mut head, 36, outlines.bbox.x_min);
        put_i16(&mut head, 38, outlines.bbox.y_min);
        put_i16(&mut head, 40, outlines.bbox.x_max);
        put_i16(&mut head, 42, outlines.bbox.y_max);
        put_i16(&mut head, 50, outlines.loca_format as i16);
        put_u16(&mut hhea, 10, outlines.advance_max);
        put_i16(&mut hhea, 12, outlines.min_lsb);
        put_i16(&mut hhea, 14, outlines.min_rsb);
        put_i16(&mut hhea, 16, outlines.x_max_extent);
        put_u16(&mut hhea, 34, outlines.long_metrics);
        out.add_raw(Tag::new(b"glyf"), outlines.glyf);
        out.add_raw(Tag::new(b"loca"), outlines.loca);
        out.add_raw(Tag::new(b"hmtx"), outlines.hmtx);
        out.add_raw(Tag::new(b"maxp"), outlines.maxp);
    } else if !default && has(b"HVAR") {
        let (hmtx, advance_max, long_metrics) = readvance(&font, coords)?;
        put_u16(&mut hhea, 10, advance_max);
        put_u16(&mut hhea, 34, long_metrics);
        out.add_raw(Tag::new(b"hmtx"), hmtx);
    }

    if !default {
        if let Ok(mvar) = font.mvar() {
            for (tag, which, offset) in MVAR_FIELDS {
                let target = match which {
                    Metrics::Os2 => os2.as_mut(),
                    Metrics::Hhea => Some(&mut hhea),
                    Metrics::Vhea => vhea.as_mut(),
                    Metrics::Post => post.as_mut(),
                };
                let (Some(target), Ok(delta)) = (target, mvar.metric_delta(Tag::new(tag), coords))
                else {
                    continue;
                };
                let delta = round(delta.to_f64());
                if delta != 0 {
                    add_i16(target, *offset, delta);
                }
            }
        }
    }

    // Il peso, la larghezza e lo stile dell'istanza, perché chi legge il file
    // (`fontdb`, un lettore di PDF) veda quel che è.
    let weight = user("wght");
    let ital = user("ital");
    let slnt = user("slnt");
    if let Some(os2) = os2.as_mut() {
        if let Some(weight) = weight {
            put_u16(os2, 4, round(weight).clamp(1, 1000) as u16);
        }
        if let Some(width) = user("wdth") {
            put_u16(os2, 6, width_class(width));
        }
        if let Some(selection) = get_u16(os2, 62) {
            let mut selection = selection;
            let italic = ital.map_or(selection & 1 != 0, |value| value >= 0.5);
            let oblique = slnt.is_some_and(|value| value != 0.0) && !italic;
            let bold = get_u16(os2, 4).is_some_and(|class| class >= 700);
            selection &= !(1 | 1 << 5 | 1 << 6 | 1 << 9);
            if italic {
                selection |= 1;
            }
            if bold {
                selection |= 1 << 5;
            }
            if !italic && !bold && !oblique {
                selection |= 1 << 6;
            }
            if oblique && get_u16(os2, 0).is_some_and(|version| version >= 4) {
                selection |= 1 << 9;
            }
            put_u16(os2, 62, selection);
            let mut style = get_u16(&head, 44).unwrap_or(0) & !0b11;
            if bold {
                style |= 1;
            }
            if italic || oblique {
                style |= 0b10;
            }
            put_u16(&mut head, 44, style);
        }
    }
    if let (Some(post), Some(slnt)) = (post.as_mut(), slnt) {
        put_i32(post, 4, (slnt.clamp(-90.0, 90.0) * 65536.0).round() as i32);
    }

    if !default {
        let store = font
            .gdef()
            .ok()
            .and_then(|gdef: Gdef| gdef.item_var_store())
            .and_then(Result::ok);
        if let Some(bytes) = settle_gpos(&font, store.as_ref(), coords) {
            out.add_raw(Tag::new(b"GPOS"), bytes);
        }
        if let Some(bytes) = settle_gsub(&font, coords) {
            out.add_raw(Tag::new(b"GSUB"), bytes);
        }
    }

    if !default {
        let values: Vec<(Tag, f64)> = axes
            .iter()
            .filter_map(|axis| Some((axis.tag(), user(&axis.tag().to_string())?)))
            .collect();
        let renamed = postscript_name(&font, &values)
            .and_then(|postscript| with_postscript_name(&font, &postscript));
        if let Some(bytes) = renamed {
            out.add_raw(Tag::new(b"name"), bytes);
        }
    }

    out.add_raw(Tag::new(b"head"), head);
    out.add_raw(Tag::new(b"hhea"), hhea);
    for (tag, bytes) in [(b"OS/2", os2), (b"post", post), (b"vhea", vhea)] {
        if let Some(bytes) = bytes {
            out.add_raw(Tag::new(tag), bytes);
        }
    }
    for record in font.table_directory().table_records() {
        let tag = record.tag();
        let dropped = VARIATIONS.iter().any(|each| Tag::new(each) == tag)
            || (redraw && HINTING.iter().any(|each| Tag::new(each) == tag));
        if dropped || out.contains(tag) {
            continue;
        }
        if let Some(data) = font.data_for_tag(tag) {
            out.add_raw(tag, data.as_bytes());
        }
    }
    Ok(out.build())
}

/// Il nome PostScript di un'istanza, come lo chiede la nota tecnica 5902 di
/// Adobe: quello di un'istanza con nome se il punto è il suo
/// (`Inter-SemiBold`), se no il prefisso della famiglia col valore di ogni
/// asse fuori dal suo punto di serie (`RobotoFlex_650wght_87.5wdth`,
/// `InterItalic_650wght`). Due pesi
/// dello stesso carattere hanno così due nomi, e un lettore di PDF o un RIP
/// che riconosce i caratteri per nome non li scambia.
fn postscript_name(font: &FontRef, values: &[(Tag, f64)]) -> Option<String> {
    let name = font.name().ok()?;
    let english = |id: u16| -> Option<String> {
        let records = name.name_record();
        let windows = |r: &&NameRecord| r.platform_id() == 3 && r.language_id() == 0x409;
        let mac = |r: &&NameRecord| r.platform_id() == 1 && r.language_id() == 0;
        let with_id = || records.iter().filter(|r| r.name_id().to_u16() == id);
        let record = with_id().find(windows).or_else(|| with_id().find(mac))?;
        let text: String = record.string(name.string_data()).ok()?.chars().collect();
        (!text.is_empty()).then_some(text)
    };
    let letters = |text: String| -> Option<String> {
        let kept: String = text.chars().filter(char::is_ascii_alphanumeric).collect();
        (!kept.is_empty()).then_some(kept)
    };
    let family = [16, 1]
        .into_iter()
        .find_map(|id| english(id).and_then(letters))?;
    let given_prefix = english(25).and_then(letters);
    let fvar = font.fvar().ok()?;
    let axes = fvar.axes().ok()?;
    // Il corsivo in un file suo ha la famiglia del tondo: senza un prefisso
    // dichiarato, «Italic» tiene distinti i due nomi dello stesso peso.
    let italic = font
        .os2()
        .is_ok_and(|os2| os2.fs_selection().bits() & 1 != 0)
        && !axes.iter().any(|axis| axis.axis_tag() == Tag::new(b"ital"));
    let prefix = given_prefix.clone().unwrap_or_else(|| {
        if italic {
            format!("{family}Italic")
        } else {
            family.clone()
        }
    });
    let fixed = |value: f64| (value * 65536.0).round() as i64;
    let value_of = |tag: Tag| {
        values
            .iter()
            .find(|(each, _)| *each == tag)
            .map(|(_, v)| *v)
    };
    let here = |coordinates: &[BigEndian<Fixed>]| {
        coordinates.len() == axes.len()
            && axes.iter().zip(coordinates).all(|(axis, coordinate)| {
                let value = value_of(axis.axis_tag()).unwrap_or(axis.default_value().to_f64());
                fixed(value) == i64::from(coordinate.get().to_bits())
            })
    };
    if let Ok(instances) = fvar.instances() {
        for instance in instances.iter().flatten() {
            if !here(instance.coordinates) {
                continue;
            }
            let given = instance
                .post_script_name_id
                .and_then(|id| english(id.to_u16()));
            let start = given_prefix.as_deref().unwrap_or(&family);
            let named = english(instance.subfamily_name_id.to_u16())
                .and_then(letters)
                .map(|subfamily| format!("{start}-{subfamily}"));
            if let Some(found) = given.or(named) {
                return Some(found);
            }
        }
    }
    let mut out = prefix.clone();
    for axis in axes {
        let Some(value) = value_of(axis.axis_tag()) else {
            continue;
        };
        if fixed(value) != i64::from(axis.default_value().to_bits()) {
            out.push('_');
            out.push_str(&shortest(value));
            out.push_str(axis.axis_tag().to_string().trim_end());
        }
    }
    if out.len() > 127 {
        // L'ultima risorsa della nota: il prefisso, un trattino, un
        // identificativo dell'istanza e tre punti.
        let digest = Sha256::digest(out.as_bytes());
        let id: String = digest[..8]
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect();
        let prefix: String = prefix.chars().take(100).collect();
        out = format!("{prefix}-{id}...");
    }
    Some(out)
}

/// Il valore di un asse in un nome PostScript: il decimale più corto che
/// torna allo stesso 16.16, senza zeri inutili e senza segno se positivo.
fn shortest(value: f64) -> String {
    let bits = (value * 65536.0).round();
    let value = bits / 65536.0;
    for places in 0..=5 {
        let text = format!("{value:.places$}");
        if text
            .parse::<f64>()
            .is_ok_and(|back| (back * 65536.0).round() == bits)
        {
            let text = if text.contains('.') {
                text.trim_end_matches('0').trim_end_matches('.')
            } else {
                &text
            };
            return if text == "-0" {
                "0".to_string()
            } else {
                text.to_string()
            };
        }
    }
    value.to_string()
}

/// La tabella `name` col nome PostScript `postscript` in ogni record che lo
/// porta, o in uno nuovo se non ce n'è.
fn with_postscript_name(font: &FontRef, postscript: &str) -> Option<Vec<u8>> {
    let mut name: Name = font.name().ok()?.to_owned_table();
    let mut found = false;
    for record in name
        .name_record
        .iter_mut()
        .filter(|r| r.name_id == NameId::POSTSCRIPT_NAME)
    {
        record.string = postscript.to_string().into();
        found = true;
    }
    if !found {
        name.name_record.push(OwnedNameRecord::new(
            3,
            1,
            0x409,
            NameId::POSTSCRIPT_NAME,
            postscript.to_string().into(),
        ));
        name.name_record
            .sort_by_key(|r| (r.platform_id, r.encoding_id, r.language_id, r.name_id));
    }
    dump_table(&name).ok()
}

/// La faccia `index` di un carattere o di una collezione.
fn face_of(sfnt: &[u8], index: u32) -> Result<FontRef<'_>, FontError> {
    let collection = sfnt.get(..4) == Some(b"ttcf");
    if !collection && index != 0 {
        return Err(FontError::NoFace(index));
    }
    FontRef::from_index(sfnt, index).map_err(|error| {
        if collection {
            FontError::NoFace(index)
        } else {
            damaged(error)
        }
    })
}

/// Una faccia statica in un file suo: il carattere com'è, o la faccia tolta
/// dalla collezione con le sue tabelle.
fn extract(sfnt: &[u8], font: &FontRef) -> Vec<u8> {
    if sfnt.get(..4) != Some(b"ttcf") {
        return sfnt.to_vec();
    }
    let mut out = FontBuilder::new();
    out.copy_missing_tables(font.clone());
    out.build()
}

fn table(font: &FontRef, tag: &[u8; 4]) -> Result<Vec<u8>, FontError> {
    font.data_for_tag(Tag::new(tag))
        .map(|data| data.as_bytes().to_vec())
        .ok_or_else(|| damaged(format_args!("no {} table", String::from_utf8_lossy(tag))))
}

fn tag_of(text: &str) -> Option<Tag> {
    Tag::new_checked(text.as_bytes()).ok()
}

/// L'arrotondamento dei caratteri (`otRound`): la metà va in su.
fn round(value: f64) -> i32 {
    (value + 0.5).floor() as i32
}

/// Il grado di `usWidthClass` più vicino a una larghezza in percentuale.
fn width_class(width: f64) -> u16 {
    let mut best = 0;
    for (class, each) in WIDTHS.iter().enumerate() {
        if (each - width).abs() < (WIDTHS[best] - width).abs() {
            best = class;
        }
    }
    best as u16 + 1
}

fn get_u16(bytes: &[u8], at: usize) -> Option<u16> {
    bytes
        .get(at..at + 2)
        .map(|b| u16::from_be_bytes([b[0], b[1]]))
}

fn put_u16(bytes: &mut [u8], at: usize, value: u16) {
    if let Some(slot) = bytes.get_mut(at..at + 2) {
        slot.copy_from_slice(&value.to_be_bytes());
    }
}

fn put_i16(bytes: &mut [u8], at: usize, value: i16) {
    put_u16(bytes, at, value as u16);
}

fn put_i32(bytes: &mut [u8], at: usize, value: i32) {
    if let Some(slot) = bytes.get_mut(at..at + 4) {
        slot.copy_from_slice(&value.to_be_bytes());
    }
}

/// Somma `delta` a un campo di 16 bit, fermandosi ai bordi.
fn add_i16(bytes: &mut [u8], at: usize, delta: i32) {
    if let Some(value) = get_u16(bytes, at) {
        let value = i32::from(value as i16) + delta;
        put_i16(
            bytes,
            at,
            value.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16,
        );
    }
}

/// Dove sta una metrica di `MVAR`.
#[derive(Clone, Copy)]
enum Metrics {
    Os2,
    Hhea,
    Vhea,
    Post,
}

/// Le metriche che `MVAR` fa variare, e il campo che cambiano: le stesse di
/// fontTools, con l'ascendente, il discendente e l'interlinea anche in
/// `hhea`, come le legge HarfBuzz.
const MVAR_FIELDS: &[(&[u8; 4], Metrics, usize)] = &[
    (b"hasc", Metrics::Os2, 68),
    (b"hdsc", Metrics::Os2, 70),
    (b"hlgp", Metrics::Os2, 72),
    (b"hasc", Metrics::Hhea, 4),
    (b"hdsc", Metrics::Hhea, 6),
    (b"hlgp", Metrics::Hhea, 8),
    (b"hcla", Metrics::Os2, 74),
    (b"hcld", Metrics::Os2, 76),
    (b"vasc", Metrics::Vhea, 4),
    (b"vdsc", Metrics::Vhea, 6),
    (b"vlgp", Metrics::Vhea, 8),
    (b"hcrs", Metrics::Hhea, 18),
    (b"hcrn", Metrics::Hhea, 20),
    (b"hcof", Metrics::Hhea, 22),
    (b"vcrs", Metrics::Vhea, 18),
    (b"vcrn", Metrics::Vhea, 20),
    (b"vcof", Metrics::Vhea, 22),
    (b"xhgt", Metrics::Os2, 86),
    (b"cpht", Metrics::Os2, 88),
    (b"sbxs", Metrics::Os2, 10),
    (b"sbys", Metrics::Os2, 12),
    (b"sbxo", Metrics::Os2, 14),
    (b"sbyo", Metrics::Os2, 16),
    (b"spxs", Metrics::Os2, 18),
    (b"spys", Metrics::Os2, 20),
    (b"spxo", Metrics::Os2, 22),
    (b"spyo", Metrics::Os2, 24),
    (b"strs", Metrics::Os2, 26),
    (b"stro", Metrics::Os2, 28),
    (b"unds", Metrics::Post, 10),
    (b"undo", Metrics::Post, 8),
];

/// I contorni ridisegnati e le tabelle che ne dipendono.
struct Outlines {
    glyf: Vec<u8>,
    loca: Vec<u8>,
    loca_format: LocaFormat,
    hmtx: Vec<u8>,
    maxp: Vec<u8>,
    bbox: Bbox,
    advance_max: u16,
    min_lsb: i16,
    min_rsb: i16,
    x_max_extent: i16,
    long_metrics: u16,
}

/// Ridisegna ogni glifo nel punto `location` e ne scrive `glyf`, `loca`,
/// `hmtx` e `maxp`, con le misure che `head` e `hhea` ne prendono.
fn redraw_outlines(font: &FontRef, location: &Location) -> Result<Outlines, FontError> {
    let count = font.maxp().map_err(damaged)?.num_glyphs();
    let outlines = font.outline_glyphs();
    let advances = Advances::new(font, location);
    let settings = || DrawSettings::unhinted(Size::unscaled(), location);
    let mut builder = GlyfLocaBuilder::new();
    let mut metrics: Vec<(u16, i16)> = Vec::with_capacity(usize::from(count));
    let mut bbox: Option<Bbox> = None;
    let (mut max_points, mut max_contours) = (0u16, 0u16);
    let (mut min_lsb, mut min_rsb, mut x_max_extent) = (i16::MAX, i16::MAX, i16::MIN);
    for gid in 0..count {
        let id = GlyphId::new(u32::from(gid));
        let mut pen = Contours::default();
        if let Some(glyph) = outlines.get(id) {
            glyph.draw(settings(), &mut pen).map_err(damaged)?;
        }
        let path = pen.finish();
        let advance = advances.get(id);
        if path.elements().is_empty() {
            builder.add_glyph(&Glyph::Empty).map_err(damaged)?;
            metrics.push((advance, 0));
            continue;
        }
        let glyph =
            SimpleGlyph::from_bezpath(&path).map_err(|error| damaged(format_args!("{error:?}")))?;
        let b = glyph.bbox;
        bbox = Some(bbox.map_or(b, |each| each.union(b)));
        max_points = max_points.max(glyph.contours.iter().map(|c| c.len() as u16).sum());
        max_contours = max_contours.max(glyph.contours.len() as u16);
        let lsb = b.x_min;
        let extent = i32::from(lsb) + i32::from(b.x_max) - i32::from(b.x_min);
        min_lsb = min_lsb.min(lsb);
        min_rsb = min_rsb.min(clamp_i16(i32::from(advance) - extent));
        x_max_extent = x_max_extent.max(clamp_i16(extent));
        builder.add_glyph(&glyph).map_err(damaged)?;
        metrics.push((advance, lsb));
    }
    let (glyf, loca, loca_format) = builder.build();
    let (hmtx, advance_max, long_metrics) = write_hmtx(&metrics)?;
    let mut maxp = vec![0u8; 32];
    put_u16(&mut maxp, 0, 1);
    put_u16(&mut maxp, 4, count);
    put_u16(&mut maxp, 6, max_points);
    put_u16(&mut maxp, 8, max_contours);
    put_u16(&mut maxp, 14, 1);
    if bbox.is_none() {
        (min_lsb, min_rsb, x_max_extent) = (0, 0, 0);
    }
    Ok(Outlines {
        glyf: dump_table(&glyf).map_err(damaged)?,
        loca: dump_table(&loca).map_err(damaged)?,
        loca_format,
        hmtx,
        maxp,
        bbox: bbox.unwrap_or_default(),
        advance_max,
        min_lsb,
        min_rsb,
        x_max_extent,
        long_metrics,
    })
}

fn clamp_i16(value: i32) -> i16 {
    value.clamp(i32::from(i16::MIN), i32::from(i16::MAX)) as i16
}

/// `hmtx` da larghezze e margini sinistri, con le larghezze uguali in coda
/// scritte una volta sola; dà anche la larghezza più grande e quante
/// larghezze ha scritto.
fn write_hmtx(metrics: &[(u16, i16)]) -> Result<(Vec<u8>, u16, u16), FontError> {
    let mut long = metrics.len().max(1);
    while long > 1 && metrics[long - 1].0 == metrics[long - 2].0 {
        long -= 1;
    }
    let long = long.min(metrics.len());
    let hmtx = Hmtx::new(
        metrics[..long]
            .iter()
            .map(|(advance, lsb)| LongMetric::new(*advance, *lsb))
            .collect(),
        metrics[long..].iter().map(|(_, lsb)| *lsb).collect(),
    );
    let advance_max = metrics
        .iter()
        .map(|(advance, _)| *advance)
        .max()
        .unwrap_or(0);
    Ok((
        dump_table(&hmtx).map_err(damaged)?,
        advance_max,
        long as u16,
    ))
}

/// Le larghezze dei glifi in un punto: quelle di `hmtx` con le variazioni di
/// `HVAR` arrotondate, come fontTools; senza `HVAR`, quelle che `skrifa`
/// ricava da `gvar`.
struct Advances<'a> {
    font: FontRef<'a>,
    hvar: Option<skrifa::raw::tables::hvar::Hvar<'a>>,
    coords: &'a [F2Dot14],
    metrics: skrifa::metrics::GlyphMetrics<'a>,
}

impl<'a> Advances<'a> {
    fn new(font: &FontRef<'a>, location: &'a Location) -> Self {
        Self {
            font: font.clone(),
            hvar: font.hvar().ok(),
            coords: location.coords(),
            metrics: font.glyph_metrics(Size::unscaled(), location),
        }
    }

    fn get(&self, id: GlyphId) -> u16 {
        let value = match (&self.hvar, self.font.hmtx()) {
            (Some(hvar), Ok(hmtx)) => {
                let base = hmtx.advance(id).unwrap_or(0);
                let delta = hvar
                    .advance_width_delta(id, self.coords)
                    .map_or(0.0, |delta| delta.to_f64());
                f64::from(base) + delta
            }
            _ => f64::from(self.metrics.advance_width(id).unwrap_or(0.0)),
        };
        round(value).clamp(0, i32::from(u16::MAX)) as u16
    }
}

/// `hmtx` con le larghezze di un punto e i margini sinistri di sempre, per un
/// carattere i cui contorni non variano ma le larghezze sì.
fn readvance(font: &FontRef, coords: &[F2Dot14]) -> Result<(Vec<u8>, u16, u16), FontError> {
    let count = font.maxp().map_err(damaged)?.num_glyphs();
    let hmtx = font.hmtx().map_err(damaged)?;
    let hvar = font.hvar().map_err(damaged)?;
    let metrics: Vec<(u16, i16)> = (0..count)
        .map(|gid| {
            let id = GlyphId::new(u32::from(gid));
            let base = f64::from(hmtx.advance(id).unwrap_or(0));
            let delta = hvar
                .advance_width_delta(id, coords)
                .map_or(0.0, |delta| delta.to_f64());
            let advance = round(base + delta).clamp(0, i32::from(u16::MAX)) as u16;
            (advance, hmtx.side_bearing(id).unwrap_or(0))
        })
        .collect();
    write_hmtx(&metrics)
}

/// La penna che raccoglie i contorni di un glifo per `write-fonts`. Le curve
/// cubiche di un CFF2 diventano quadratiche; un contorno senza segmenti (un
/// punto solo, che serve alle istruzioni e non si vede) resta fuori.
#[derive(Default)]
struct Contours {
    path: BezPath,
    contour: Vec<PathEl>,
    start: (f64, f64),
    last: (f64, f64),
}

impl Contours {
    fn flush(&mut self) {
        let contour = std::mem::take(&mut self.contour);
        let drawn = contour
            .iter()
            .any(|el| matches!(el, PathEl::LineTo(_) | PathEl::QuadTo(..)));
        if drawn {
            self.path.extend(contour);
        }
    }

    fn finish(mut self) -> BezPath {
        self.flush();
        self.path
    }
}

impl OutlinePen for Contours {
    fn move_to(&mut self, x: f32, y: f32) {
        self.flush();
        let point = (f64::from(x), f64::from(y));
        self.contour.push(PathEl::MoveTo(point.into()));
        self.start = point;
        self.last = point;
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let point = (f64::from(x), f64::from(y));
        self.contour.push(PathEl::LineTo(point.into()));
        self.last = point;
    }

    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        let point = (f64::from(x), f64::from(y));
        self.contour.push(PathEl::QuadTo(
            (f64::from(cx), f64::from(cy)).into(),
            point.into(),
        ));
        self.last = point;
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let cubic = CubicBez::new(
            self.last,
            (f64::from(cx0), f64::from(cy0)),
            (f64::from(cx1), f64::from(cy1)),
            (f64::from(x), f64::from(y)),
        );
        // La tolleranza di `subsetter` e di `vello`: un quarantesimo di unità.
        for (_, _, quad) in cubic.to_quads(0.025) {
            self.contour.push(PathEl::QuadTo(quad.p1, quad.p2));
        }
        self.last = (f64::from(x), f64::from(y));
    }

    fn close(&mut self) {
        self.contour.push(PathEl::ClosePath);
        self.flush();
        self.last = self.start;
    }
}

// --- il GPOS e il GSUB in un punto ------------------------------------------

/// Il `GPOS` con le variazioni della crenatura e degli attacchi sommate ai
/// valori del punto `coords`, e le `FeatureVariations` risolte. `None` se non
/// c'è niente da cambiare, o se il `GPOS` riscritto non si scrive: allora resta
/// quello di serie, con la crenatura del punto di serie.
fn settle_gpos(
    font: &FontRef,
    store: Option<&ItemVariationStore>,
    coords: &[F2Dot14],
) -> Option<Vec<u8>> {
    let read = font.gpos().ok()?;
    let has_variations = read.feature_variations().is_some();
    if store.is_none() && !has_variations {
        return None;
    }
    let mut gpos: Gpos = read.to_owned_table();
    if let Some(store) = store {
        let delta = |device: &DeviceOrVariationIndex| -> Option<i32> {
            let DeviceOrVariationIndex::VariationIndex(index) = device else {
                return None;
            };
            let index = DeltaSetIndex {
                outer: index.delta_set_outer_index,
                inner: index.delta_set_inner_index,
            };
            Some(store.compute_delta(index, coords).unwrap_or(0))
        };
        for lookup in gpos.lookup_list.lookups.iter_mut() {
            settle_lookup(lookup, &delta);
        }
    }
    let features = std::mem::take(&mut gpos.feature_variations).into_inner();
    settle_features(&mut gpos.feature_list, features, coords);
    dump_table(&gpos).ok()
}

/// Il `GSUB` con le `FeatureVariations` risolte nel punto `coords`, o `None`
/// se non ne ha.
fn settle_gsub(font: &FontRef, coords: &[F2Dot14]) -> Option<Vec<u8>> {
    let read = font.gsub().ok()?;
    read.feature_variations()?.ok()?;
    let mut gsub: Gsub = read.to_owned_table();
    let features = std::mem::take(&mut gsub.feature_variations).into_inner();
    settle_features(&mut gsub.feature_list, features, coords);
    dump_table(&gsub).ok()
}

/// Sostituisce le funzioni del primo `FeatureVariationRecord` le cui
/// condizioni valgono nel punto `coords`, come fa il motore di composizione.
fn settle_features(
    list: &mut FeatureList,
    variations: Option<FeatureVariations>,
    coords: &[F2Dot14],
) {
    let Some(variations) = variations else {
        return;
    };
    for record in variations.feature_variation_records {
        let holds = record
            .condition_set
            .as_ref()
            .is_none_or(|set| set.conditions.iter().all(|each| holds(each, coords)));
        if !holds {
            continue;
        }
        if let Some(substitution) = record.feature_table_substitution.into_inner() {
            for each in substitution.substitutions {
                if let Some(feature) = list
                    .feature_records
                    .get_mut(usize::from(each.feature_index))
                {
                    feature.feature = each.alternate_feature.into_inner().into();
                }
            }
        }
        return;
    }
}

/// Se una condizione vale nel punto `coords`. Una condizione su un valore che
/// varia (formato 2) non si sa calcolare qui, e non vale.
fn holds(condition: &Condition, coords: &[F2Dot14]) -> bool {
    match condition {
        Condition::Format1AxisRange(range) => {
            let value = coords
                .get(usize::from(range.axis_index))
                .copied()
                .unwrap_or_default();
            range.filter_range_min_value <= value && value <= range.filter_range_max_value
        }
        Condition::Format2VariableValue(_) => false,
        Condition::Format3And(all) => all.conditions.iter().all(|each| holds(each, coords)),
        Condition::Format4Or(any) => any.conditions.iter().any(|each| holds(each, coords)),
        Condition::Format5Negate(not) => !holds(&not.condition, coords),
    }
}

/// Somma le variazioni ai valori di una ricerca del `GPOS`.
fn settle_lookup(
    lookup: &mut PositionLookup,
    delta: &dyn Fn(&DeviceOrVariationIndex) -> Option<i32>,
) {
    match lookup {
        PositionLookup::Single(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_single(table, delta);
            }
        }
        PositionLookup::Pair(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_pair(table, delta);
            }
        }
        PositionLookup::Cursive(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_cursive(table, delta);
            }
        }
        PositionLookup::MarkToBase(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_mark_base(table, delta);
            }
        }
        PositionLookup::MarkToLig(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_mark_lig(table, delta);
            }
        }
        PositionLookup::MarkToMark(lookup) => {
            for table in lookup.subtables.iter_mut() {
                settle_mark_mark(table, delta);
            }
        }
        PositionLookup::Contextual(_) | PositionLookup::ChainContextual(_) => {}
        PositionLookup::Extension(lookup) => {
            for table in lookup.subtables.iter_mut() {
                match &mut **table {
                    ExtensionSubtable::Single(ext) => settle_single(&mut ext.extension, delta),
                    ExtensionSubtable::Pair(ext) => settle_pair(&mut ext.extension, delta),
                    ExtensionSubtable::Cursive(ext) => settle_cursive(&mut ext.extension, delta),
                    ExtensionSubtable::MarkToBase(ext) => {
                        settle_mark_base(&mut ext.extension, delta)
                    }
                    ExtensionSubtable::MarkToLig(ext) => settle_mark_lig(&mut ext.extension, delta),
                    ExtensionSubtable::MarkToMark(ext) => {
                        settle_mark_mark(&mut ext.extension, delta)
                    }
                    ExtensionSubtable::Contextual(_) | ExtensionSubtable::ChainContextual(_) => {}
                }
            }
        }
    }
}

type Delta<'d> = &'d dyn Fn(&DeviceOrVariationIndex) -> Option<i32>;

fn settle_single(table: &mut SinglePos, delta: Delta) {
    match table {
        SinglePos::Format1(table) => settle_value(&mut table.value_record, delta),
        SinglePos::Format2(table) => {
            for record in table.value_records.iter_mut() {
                settle_value(record, delta);
            }
        }
    }
}

fn settle_pair(table: &mut PairPos, delta: Delta) {
    match table {
        PairPos::Format1(table) => {
            for set in table.pair_sets.iter_mut() {
                for record in set.pair_value_records.iter_mut() {
                    settle_value(&mut record.value_record1, delta);
                    settle_value(&mut record.value_record2, delta);
                }
            }
        }
        PairPos::Format2(table) => {
            for first in table.class1_records.iter_mut() {
                for record in first.class2_records.iter_mut() {
                    settle_value(&mut record.value_record1, delta);
                    settle_value(&mut record.value_record2, delta);
                }
            }
        }
    }
}

fn settle_cursive(table: &mut write_fonts::tables::gpos::CursivePosFormat1, delta: Delta) {
    for record in table.entry_exit_record.iter_mut() {
        settle_anchor(&mut record.entry_anchor, delta);
        settle_anchor(&mut record.exit_anchor, delta);
    }
}

fn settle_marks(marks: &mut write_fonts::tables::gpos::MarkArray, delta: Delta) {
    for record in marks.mark_records.iter_mut() {
        settle_anchor_table(&mut record.mark_anchor, delta);
    }
}

fn settle_mark_base(table: &mut write_fonts::tables::gpos::MarkBasePosFormat1, delta: Delta) {
    settle_marks(&mut table.mark_array, delta);
    for record in table.base_array.base_records.iter_mut() {
        for anchor in record.base_anchors.iter_mut() {
            settle_anchor(anchor, delta);
        }
    }
}

fn settle_mark_lig(table: &mut write_fonts::tables::gpos::MarkLigPosFormat1, delta: Delta) {
    settle_marks(&mut table.mark_array, delta);
    for attach in table.ligature_array.ligature_attaches.iter_mut() {
        for component in attach.component_records.iter_mut() {
            for anchor in component.ligature_anchors.iter_mut() {
                settle_anchor(anchor, delta);
            }
        }
    }
}

fn settle_mark_mark(table: &mut write_fonts::tables::gpos::MarkMarkPosFormat1, delta: Delta) {
    settle_marks(&mut table.mark1_array, delta);
    for record in table.mark2_array.mark2_records.iter_mut() {
        for anchor in record.mark2_anchors.iter_mut() {
            settle_anchor(anchor, delta);
        }
    }
}

fn settle_anchor(anchor: &mut NullableOffsetMarker<AnchorTable>, delta: Delta) {
    if let Some(anchor) = anchor.as_mut() {
        settle_anchor_table(anchor, delta);
    }
}

/// Un attacco con le variazioni sommate alle coordinate. Le tabelle dei pixel
/// (`Device`) restano.
fn settle_anchor_table(anchor: &mut AnchorTable, delta: Delta) {
    let AnchorTable::Format3(anchor) = anchor else {
        return;
    };
    for (value, device) in [
        (&mut anchor.x_coordinate, &mut anchor.x_device),
        (&mut anchor.y_coordinate, &mut anchor.y_device),
    ] {
        if let Some(shift) = device.as_ref().and_then(delta) {
            *value = clamp_i16(i32::from(*value) + shift);
            device.clear();
        }
    }
}

/// Un valore del `GPOS` con le variazioni sommate. Il formato resta quello di
/// tutta la sottotabella, che i valori devono condividere, con in più il campo
/// di ogni variazione: dove c'era soltanto la variazione ora c'è il numero.
fn settle_value(record: &mut ValueRecord, delta: Delta) {
    let mut format = record.format();
    for (value, device, value_bit, device_bit) in [
        (
            &mut record.x_placement,
            &mut record.x_placement_device,
            ValueFormat::X_PLACEMENT,
            ValueFormat::X_PLACEMENT_DEVICE,
        ),
        (
            &mut record.y_placement,
            &mut record.y_placement_device,
            ValueFormat::Y_PLACEMENT,
            ValueFormat::Y_PLACEMENT_DEVICE,
        ),
        (
            &mut record.x_advance,
            &mut record.x_advance_device,
            ValueFormat::X_ADVANCE,
            ValueFormat::X_ADVANCE_DEVICE,
        ),
        (
            &mut record.y_advance,
            &mut record.y_advance_device,
            ValueFormat::Y_ADVANCE,
            ValueFormat::Y_ADVANCE_DEVICE,
        ),
    ] {
        if !format.contains(device_bit) {
            continue;
        }
        format |= value_bit;
        let shift = device.as_ref().and_then(delta);
        if let Some(shift) = shift {
            *value = Some(clamp_i16(i32::from(value.unwrap_or(0)) + shift));
            device.clear();
        } else if value.is_none() {
            *value = Some(0);
        }
    }
    record.set_explicit_value_format(format);
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::PathBuf;

    use kurbo::Shape;
    use resvg::tiny_skia::Pixmap;
    use resvg::usvg;
    use serde_json::Value;
    use skrifa::raw::FontData;

    use super::*;

    /// Un carattere variabile distribuito con l'app.
    pub(crate) fn app_font(name: &str) -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/client/public/fonts")
            .join(name);
        std::fs::read(&path).unwrap_or_else(|e| panic!("{name}: {e}"))
    }

    /// Un'istanza statica di fontTools, accanto al crate.
    fn static_font(name: &str) -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fonts")
            .join(name);
        std::fs::read(&path).unwrap_or_else(|e| panic!("{name}: {e}"))
    }

    /// Lo stesso carattere con un altro nome di famiglia, perché le prove non
    /// usino un nome di Fub.
    pub(crate) fn renamed(sfnt: &[u8], family: &str) -> Vec<u8> {
        let font = FontRef::new(sfnt).unwrap();
        let mut name: Name = font.name().unwrap().to_owned_table();
        for record in name.name_record.iter_mut() {
            let id = record.name_id.to_u16();
            if matches!(id, 1 | 16 | 21) {
                record.string = family.to_string().into();
            } else if matches!(id, 4 | 6 | 17 | 22) && id != 17 {
                let full = if id == 6 {
                    family.replace(' ', "")
                } else {
                    family.to_string()
                };
                record.string = full.into();
            }
        }
        let mut out = FontBuilder::new();
        out.add_table(&name).unwrap();
        out.copy_missing_tables(font);
        out.build()
    }

    /// Una collezione con i caratteri dati, ognuno con le sue tabelle.
    pub(crate) fn collection(fonts: &[&[u8]]) -> Vec<u8> {
        let header = 12 + 4 * fonts.len();
        let mut directories = Vec::new();
        let mut size = header;
        for font in fonts {
            let tables = usize::from(u16::from_be_bytes([font[4], font[5]]));
            directories.push(size);
            size += 12 + 16 * tables;
        }
        let mut out = vec![0u8; size];
        out[..4].copy_from_slice(b"ttcf");
        out[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        out[8..12].copy_from_slice(&(fonts.len() as u32).to_be_bytes());
        for (i, (font, at)) in fonts.iter().zip(&directories).enumerate() {
            out[12 + 4 * i..16 + 4 * i].copy_from_slice(&(*at as u32).to_be_bytes());
            let tables = usize::from(u16::from_be_bytes([font[4], font[5]]));
            out[*at..*at + 12].copy_from_slice(&font[..12]);
            for t in 0..tables {
                let record = &font[12 + 16 * t..28 + 16 * t];
                let offset = u32::from_be_bytes(record[8..12].try_into().unwrap()) as usize;
                let length = u32::from_be_bytes(record[12..16].try_into().unwrap()) as usize;
                while out.len() % 4 != 0 {
                    out.push(0);
                }
                let moved = out.len() as u32;
                out.extend_from_slice(&font[offset..offset + length]);
                let slot = *at + 12 + 16 * t;
                out[slot..slot + 8].copy_from_slice(&record[..8]);
                out[slot + 8..slot + 12].copy_from_slice(&moved.to_be_bytes());
                out[slot + 12..slot + 16].copy_from_slice(&record[12..16]);
            }
        }
        out
    }

    /// Lo stesso carattere con un altro `fsType`, la licenza d'incorporarlo.
    pub(crate) fn with_fs_type(sfnt: &[u8], fs_type: u16) -> Vec<u8> {
        let font = FontRef::new(sfnt).unwrap();
        let record = font
            .table_directory()
            .table_records()
            .iter()
            .find(|record| record.tag() == Tag::new(b"OS/2"))
            .unwrap();
        let at = record.offset() as usize + 8;
        let mut out = sfnt.to_vec();
        out[at..at + 2].copy_from_slice(&fs_type.to_be_bytes());
        out
    }

    #[test]
    fn the_licence_says_whether_a_font_embeds() {
        let font = decode(&app_font("inter-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        assert!(embeddable(&font, 0));
        let cases = [
            (0x0000, true),
            (0x0002, false),
            (0x0004, true),
            (0x0008, true),
            // Due usi insieme: vale quello che concede di più.
            (0x0006, true),
            (0x0100, false),
            (0x0108, false),
            (0x0200, false),
        ];
        for (fs_type, expected) in cases {
            let font = with_fs_type(&font, fs_type);
            assert_eq!(embeddable(&font, 0), expected, "{fs_type:#06x}");
        }
        assert!(embeddable(b"not a font", 0));
    }

    fn tags(sfnt: &[u8]) -> Vec<String> {
        FontRef::new(sfnt)
            .unwrap()
            .table_directory()
            .table_records()
            .iter()
            .map(|record| record.tag().to_string())
            .collect()
    }

    #[test]
    fn a_woff2_becomes_the_font_inside_and_a_plain_font_stays_as_it_is() {
        let woff2 = app_font("inter-latin-wght-normal.woff2");
        let sfnt = decode(&woff2).unwrap();
        assert_eq!(&sfnt[..4], b"\0\x01\0\0");
        assert!(FontRef::new(&sfnt).is_ok());
        let ttf = static_font("inter-400.ttf");
        assert!(matches!(decode(&ttf).unwrap(), Cow::Borrowed(_)));
    }

    #[test]
    fn what_is_not_a_font_or_promises_too_much_is_refused() {
        assert_eq!(decode(b"<svg/>").unwrap_err(), FontError::NotAFont);
        assert_eq!(decode(b"").unwrap_err(), FontError::NotAFont);
        // Un WOFF2 che promette un carattere più grande del tetto non si apre.
        let mut woff2 = app_font("inter-latin-wght-normal.woff2");
        woff2[16..20].copy_from_slice(&(MAX_FONT_BYTES as u32 + 1).to_be_bytes());
        assert_eq!(decode(&woff2).unwrap_err(), FontError::TooLarge);
        let mut woff = b"wOFF".to_vec();
        woff.resize(44, 0);
        woff[16..20].copy_from_slice(&u32::MAX.to_be_bytes());
        assert_eq!(decode(&woff).unwrap_err(), FontError::TooLarge);
        // Troncato, è un carattere rovinato, non un panico.
        let woff2 = app_font("inter-latin-wght-normal.woff2");
        assert!(matches!(
            decode(&woff2[..woff2.len() / 2]),
            Err(FontError::Damaged(_))
        ));
        assert!(matches!(decode(&woff2[..10]), Err(FontError::Damaged(_))));
    }

    #[test]
    fn a_variable_font_says_its_family_axes_weights_and_generic() {
        let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        let faces = describe(&sfnt).unwrap();
        assert_eq!(faces.len(), 1);
        let inter = &faces[0];
        assert_eq!(inter.family, "Inter");
        assert_eq!(inter.weight, [100.0, 900.0]);
        assert_eq!(inter.stretch, [100.0, 100.0]);
        assert_eq!(inter.generic, Generic::SansSerif);
        assert_eq!(
            inter.styles,
            [Slot {
                style: Style::Normal,
                fixed: vec![]
            }]
        );
        assert_eq!(inter.axes.len(), 1);
        assert_eq!(inter.axes[0].tag, "wght");
        assert!(inter.is_reserved());

        let italic = decode(&app_font("inter-latin-wght-italic.woff2"))
            .unwrap()
            .into_owned();
        assert_eq!(describe(&italic).unwrap()[0].styles[0].style, Style::Italic);
        let serif = decode(&app_font("literata-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        assert_eq!(describe(&serif).unwrap()[0].generic, Generic::Serif);
        let mono = decode(&app_font("jetbrains-mono-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        assert_eq!(describe(&mono).unwrap()[0].generic, Generic::Monospace);

        let bold = describe(&static_font("inter-700.ttf")).unwrap();
        assert_eq!(bold[0].weight, [700.0, 700.0]);
        assert!(bold[0].axes.is_empty());
    }

    #[test]
    fn the_generic_comes_from_the_name_then_the_file_then_the_letters() {
        assert_eq!(by_name("Noto Sans Mono"), Some(Generic::Monospace));
        assert_eq!(by_name("Microsoft Sans Serif"), Some(Generic::SansSerif));
        assert_eq!(by_name("PT Serif Caption"), Some(Generic::Serif));
        assert_eq!(by_name("Roboto-Slab"), Some(Generic::Serif));
        assert_eq!(by_name("Dancing Script"), Some(Generic::Cursive));
        assert_eq!(by_name("Monoton"), None);
        assert_eq!(by_name("Literata"), None);
        assert_eq!(
            by_panose(&[2, 11, 5, 3, 0, 0, 0, 0, 0, 0], 0),
            Some(Generic::SansSerif)
        );
        assert_eq!(
            by_panose(&[2, 2, 5, 3, 0, 0, 0, 0, 0, 0], 0),
            Some(Generic::Serif)
        );
        assert_eq!(
            by_panose(&[3, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0),
            Some(Generic::Cursive)
        );
        assert_eq!(by_panose(&[0; 10], 0x0105), Some(Generic::Serif));
        assert_eq!(by_panose(&[0; 10], 0x0800), Some(Generic::SansSerif));
        assert_eq!(by_panose(&[0; 10], 0), None);
        // Literata non lo dice né col nome né col file: lo dicono le lettere,
        // anche in corsivo, e un corsivo senza grazie resta senza.
        for (name, expected) in [
            ("literata-latin-wght-normal.woff2", Generic::Serif),
            ("literata-latin-wght-italic.woff2", Generic::Serif),
            ("inter-latin-wght-normal.woff2", Generic::SansSerif),
            ("inter-latin-wght-italic.woff2", Generic::SansSerif),
        ] {
            let sfnt = decode(&app_font(name)).unwrap().into_owned();
            assert_eq!(
                by_shape(&FontRef::new(&sfnt).unwrap()),
                Some(expected),
                "{name}"
            );
        }
        let renamed = renamed(&static_font("literata-400.ttf"), "Prova");
        assert_eq!(describe(&renamed).unwrap()[0].generic, Generic::Serif);
    }

    #[test]
    fn a_renamed_face_is_called_by_its_new_name() {
        let sfnt = renamed(&static_font("literata-400.ttf"), "Prova Serif");
        let face = &describe(&sfnt).unwrap()[0];
        assert_eq!(face.family, "Prova Serif");
        assert!(face.is_called("prova serif"));
        assert!(!face.is_reserved());
    }

    #[test]
    fn a_collection_has_one_face_per_font_and_each_comes_out_alone() {
        let first = renamed(&static_font("inter-400.ttf"), "Prima");
        let second = renamed(&static_font("literata-700.ttf"), "Seconda");
        let ttc = collection(&[&first, &second]);
        let faces = describe(&ttc).unwrap();
        let names: Vec<_> = faces
            .iter()
            .map(|face| (face.index, face.family.as_str()))
            .collect();
        assert_eq!(names, [(0, "Prima"), (1, "Seconda")]);
        let alone = instance(&ttc, 1, &[]).unwrap();
        assert_eq!(&alone[..4], b"\0\x01\0\0");
        let face = &describe(&alone).unwrap()[0];
        assert_eq!(
            (face.family.as_str(), face.weight),
            ("Seconda", [700.0, 700.0])
        );
        assert_eq!(instance(&ttc, 2, &[]).unwrap_err(), FontError::NoFace(2));
        assert_eq!(instance(&first, 1, &[]).unwrap_err(), FontError::NoFace(1));
        // Una faccia statica fuori da una collezione esce com'è.
        assert_eq!(instance(&first, 0, &[]).unwrap(), first);
    }

    #[test]
    fn the_shared_vectors_choose_the_same_face() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/client/src/__fixtures__/scene-fonts/choose.json");
        let text = std::fs::read_to_string(&path).unwrap();
        let vectors: Vec<Value> = serde_json::from_str(&text).unwrap();
        assert!(vectors.len() >= 30);
        for vector in vectors {
            let name = vector["name"].as_str().unwrap();
            let files: Vec<Vec<Face>> = serde_json::from_value(vector["files"].clone())
                .unwrap_or_else(|e| panic!("{name}: {e}"));
            let files: Vec<&[Face]> = files.iter().map(Vec::as_slice).collect();
            let family = vector["family"].as_str().unwrap();
            if let Some(generic) = vector["expect"].get("generic") {
                let expected: Generic = serde_json::from_value(generic.clone()).unwrap();
                assert_eq!(family_generic(&files, family), Some(expected), "{name}");
                continue;
            }
            let request: Request = serde_json::from_value(vector["request"].clone()).unwrap();
            let actual = choose(&files, family, &request)
                .map(|choice| serde_json::to_value(choice).unwrap());
            let expected = &vector["expect"];
            match (actual, expected) {
                (None, Value::Null) => {}
                (Some(actual), Value::Object(_)) => {
                    assert_eq!(actual["file"], expected["file"], "{name}");
                    assert_eq!(actual["face"], expected["face"], "{name}");
                    let pairs = |value: &Value| -> Vec<(String, f64)> {
                        value["coordinates"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|c| {
                                (
                                    c["tag"].as_str().unwrap().to_string(),
                                    c["value"].as_f64().unwrap(),
                                )
                            })
                            .collect()
                    };
                    assert_eq!(pairs(&actual), pairs(expected), "{name}");
                }
                (actual, expected) => panic!("{name}: {actual:?} invece di {expected}"),
            }
        }
    }

    /// Le misure di un glifo, per confrontare due caratteri glifo per glifo:
    /// la larghezza, il riquadro dei contorni, l'area che racchiudono e la
    /// loro lunghezza.
    fn glyphs(sfnt: &[u8]) -> Vec<(u16, [f64; 4], f64, f64)> {
        let font = FontRef::new(sfnt).unwrap();
        let outlines = font.outline_glyphs();
        let hmtx = font.hmtx().unwrap();
        let location = Location::default();
        (0..font.maxp().unwrap().num_glyphs())
            .map(|gid| {
                let id = GlyphId::new(u32::from(gid));
                let mut pen = Contours::default();
                if let Some(glyph) = outlines.get(id) {
                    glyph
                        .draw(
                            DrawSettings::unhinted(Size::unscaled(), &location),
                            &mut pen,
                        )
                        .unwrap();
                }
                let path = pen.finish();
                let b = path.bounding_box();
                let area = path.area();
                (
                    hmtx.advance(id).unwrap(),
                    [b.x0, b.y0, b.x1, b.y1],
                    area,
                    path.perimeter(0.1),
                )
            })
            .collect()
    }

    /// Un testo disegnato da `resvg` con un carattere solo.
    fn render(sfnt: Vec<u8>, text: &str) -> Pixmap {
        let mut db = fontdb::Database::new();
        db.load_font_source(fontdb::Source::Binary(Arc::new(sfnt)));
        let family = db.faces().next().unwrap().families[0].0.clone();
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="120"><text x="10" y="90" font-family="{family}" font-size="72">{text}</text></svg>"#
        );
        let options = usvg::Options {
            fontdb: Arc::new(db),
            ..usvg::Options::default()
        };
        let tree = usvg::Tree::from_str(&svg, &options).unwrap();
        let mut pixmap = Pixmap::new(1400, 120).unwrap();
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::identity(),
            &mut pixmap.as_mut(),
        );
        pixmap
    }

    /// Quanti pixel cambiano di più di un ottavo fra due immagini.
    fn changed(a: &Pixmap, b: &Pixmap) -> usize {
        a.data()
            .chunks(4)
            .zip(b.data().chunks(4))
            .filter(|(x, y)| x[3].abs_diff(y[3]) > 32)
            .count()
    }

    const KERNED: &str = "AVATAR WAVE Ty To Yo P. «Vè»";

    #[test]
    fn the_bold_instance_is_the_one_fonttools_made() {
        // Il grassetto di Inter che l'export usa da sempre l'ha fissato
        // fontTools, dallo stesso file variabile: l'istanza di qui deve
        // essere lo stesso carattere, glifo per glifo, entro un'unità per
        // punto. Un punto può cadere sull'altra unità: fontTools conta le
        // coordinate normalizzate coi decimali, la specifica e i motori in
        // F2Dot14, e il punto di Inter sale a 324,505 unità, 325 qui e 324
        // in fontTools.
        let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        let coordinates = [Coordinate {
            tag: "wght".into(),
            value: 700.0,
        }];
        let ours = instance(&sfnt, 0, &coordinates).unwrap();
        let theirs = static_font("inter-700.ttf");
        let (a, b) = (glyphs(&ours), glyphs(&theirs));
        assert_eq!(a.len(), b.len());
        for (gid, (mine, other)) in a.iter().zip(&b).enumerate() {
            assert!(
                mine.0.abs_diff(other.0) <= 1,
                "glifo {gid}: larghezza {} invece di {}",
                mine.0,
                other.0
            );
            for k in 0..4 {
                assert!(
                    (mine.1[k] - other.1[k]).abs() <= 1.0,
                    "glifo {gid}: riquadro {:?} invece di {:?}",
                    mine.1,
                    other.1
                );
            }
            // Un'unità su tutto il contorno sposta l'area al più della sua
            // lunghezza; un grassetto sbagliato di cento la sposta di dieci.
            assert!(
                (mine.2 - other.2).abs() <= other.3.max(1.0),
                "glifo {gid}: area {} invece di {}",
                mine.2,
                other.2
            );
        }
        // La crenatura del grassetto: lo stesso testo esce uguale.
        let pixels = changed(&render(ours, KERNED), &render(theirs, KERNED));
        assert!(pixels <= 60, "{pixels} pixel diversi");
    }

    #[test]
    fn the_kerning_of_the_bold_is_not_the_kerning_of_the_regular() {
        // La prova di sopra vede la crenatura: col GPOS di serie, il
        // grassetto ha la crenatura del tondo e il testo si sposta.
        let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        let coordinates = [Coordinate {
            tag: "wght".into(),
            value: 700.0,
        }];
        let ours = instance(&sfnt, 0, &coordinates).unwrap();
        let font = FontRef::new(&ours).unwrap();
        let original = FontRef::new(&sfnt).unwrap();
        let mut unsettled = FontBuilder::new();
        unsettled.add_raw(
            Tag::new(b"GPOS"),
            original.data_for_tag(Tag::new(b"GPOS")).unwrap().as_bytes(),
        );
        unsettled.copy_missing_tables(font);
        let unsettled = unsettled.build();
        let theirs = static_font("inter-700.ttf");
        let settled = changed(&render(ours, KERNED), &render(theirs.clone(), KERNED));
        let default = changed(&render(unsettled, KERNED), &render(theirs, KERNED));
        assert!(
            default > settled * 4 && default > 200,
            "{default} contro {settled}"
        );
    }

    #[test]
    fn an_instance_has_no_axes_and_says_its_weight() {
        let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        let coordinates = [Coordinate {
            tag: "wght".into(),
            value: 600.0,
        }];
        let font = instance(&sfnt, 0, &coordinates).unwrap();
        let tables = tags(&font);
        for gone in ["fvar", "gvar", "avar", "HVAR", "MVAR", "STAT"] {
            assert!(
                !tables.iter().any(|tag| tag == gone),
                "{gone} in {tables:?}"
            );
        }
        for kept in [
            "glyf", "loca", "hmtx", "cmap", "name", "GPOS", "GSUB", "OS/2", "post",
        ] {
            assert!(tables.iter().any(|tag| tag == kept), "manca {kept}");
        }
        let face = &describe(&font).unwrap()[0];
        assert_eq!(face.weight, [600.0, 600.0]);
        assert!(face.axes.is_empty());
        assert_eq!(face.family, "Inter");
        let read = FontRef::new(&font).unwrap();
        assert_eq!(read.os2().unwrap().us_weight_class(), 600);
        // Un'istanza si rilegge con `fontdb`, e il punto di un asse fuori dal
        // carattere si ferma al bordo.
        let heavy = instance(
            &sfnt,
            0,
            &[Coordinate {
                tag: "wght".into(),
                value: 2000.0,
            }],
        )
        .unwrap();
        assert_eq!(describe(&heavy).unwrap()[0].weight, [900.0, 900.0]);
        // Due istanze dello stesso punto sono gli stessi byte.
        assert_eq!(instance(&sfnt, 0, &coordinates).unwrap(), font);
    }

    #[test]
    fn an_instance_has_its_own_postscript_name() {
        let names = |file: &str, weights: &[f64]| -> Vec<String> {
            let sfnt = decode(&app_font(file)).unwrap().into_owned();
            weights
                .iter()
                .map(|weight| {
                    let coordinates = [Coordinate {
                        tag: "wght".into(),
                        value: *weight,
                    }];
                    let font = instance(&sfnt, 0, &coordinates).unwrap();
                    let mut db = fontdb::Database::new();
                    db.load_font_source(fontdb::Source::Binary(Arc::new(font)));
                    let name = db.faces().next().unwrap().post_script_name.clone();
                    name
                })
                .collect()
        };
        assert_eq!(
            names(
                "inter-latin-wght-normal.woff2",
                &[400.0, 600.0, 650.0, 700.0]
            ),
            [
                "Inter-Regular",
                "Inter-SemiBold",
                "Inter_650wght",
                "Inter-Bold"
            ]
        );
        // Il corsivo di Literata non ha istanze con nome né un prefisso suo.
        assert_eq!(
            names("literata-latin-wght-italic.woff2", &[400.0, 600.0, 650.5]),
            [
                "Literata-Italic",
                "LiterataItalic_600wght",
                "LiterataItalic_650.5wght"
            ]
        );
        assert_eq!(shortest(87.5), "87.5");
        assert_eq!(shortest(-12.0), "-12");
        assert_eq!(shortest(-0.0), "0");
        assert_eq!(shortest(1.0 / 3.0), "0.33333");
        assert_eq!(shortest(650.0), "650");
    }

    #[test]
    fn the_default_point_keeps_the_outlines_and_drops_the_axes() {
        let sfnt = decode(&app_font("inter-latin-wght-normal.woff2"))
            .unwrap()
            .into_owned();
        let font = instance(&sfnt, 0, &[]).unwrap();
        let read = FontRef::new(&font).unwrap();
        let original = FontRef::new(&sfnt).unwrap();
        assert!(read.axes().is_empty());
        assert_eq!(
            read.data_for_tag(Tag::new(b"glyf")).unwrap().as_bytes(),
            original.data_for_tag(Tag::new(b"glyf")).unwrap().as_bytes()
        );
        assert_eq!(describe(&font).unwrap()[0].weight, [400.0, 400.0]);
    }

    #[test]
    fn every_app_font_survives_an_instance_at_every_weight_of_the_menu() {
        for name in [
            "inter-latin-wght-normal.woff2",
            "inter-latin-wght-italic.woff2",
            "literata-latin-wght-normal.woff2",
            "literata-latin-wght-italic.woff2",
            "jetbrains-mono-latin-wght-normal.woff2",
            "jetbrains-mono-latin-wght-italic.woff2",
        ] {
            let sfnt = decode(&app_font(name)).unwrap().into_owned();
            for weight in [300.0, 500.0, 800.0] {
                let font = instance(
                    &sfnt,
                    0,
                    &[Coordinate {
                        tag: "wght".into(),
                        value: weight,
                    }],
                )
                .unwrap_or_else(|e| panic!("{name} {weight}: {e}"));
                let read = FontRef::new(&font).unwrap();
                let gpos = read.gpos().unwrap();
                // Il GPOS riscritto si rilegge, e tutto il carattere anche.
                assert!(gpos.lookup_list().is_ok(), "{name}");
                assert!(!glyphs(&font).is_empty());
                let _ = FontData::new(&font);
            }
        }
    }
}
