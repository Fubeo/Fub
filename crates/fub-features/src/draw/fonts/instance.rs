//! Istanziare una faccia variabile in un punto: i contorni ridisegnati, le
//! metriche e i nomi del carattere statico che ne esce.

use kurbo::{BezPath, CubicBez, PathEl};
use sha2::{Digest, Sha256};
use skrifa::instance::{Location, LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::raw::tables::gdef::Gdef;
use skrifa::raw::tables::name::NameRecord;
use skrifa::raw::types::{BigEndian, F2Dot14, Fixed, NameId};
use skrifa::raw::{FontRef, TableProvider};
use skrifa::{GlyphId, MetadataProvider, Tag};
use write_fonts::from_obj::ToOwnedTable;
use write_fonts::tables::glyf::{Bbox, GlyfLocaBuilder, Glyph, SimpleGlyph};
use write_fonts::tables::hmtx::{Hmtx, LongMetric};
use write_fonts::tables::loca::LocaFormat;
use write_fonts::tables::name::{Name, NameRecord as OwnedNameRecord};
use write_fonts::{dump_table, FontBuilder};

use super::describe::{Coordinate, WIDTHS};
use super::settle::{settle_gpos, settle_gsub};
use super::{damaged, FontError};

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
pub(super) fn shortest(value: f64) -> String {
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

pub(super) fn clamp_i16(value: i32) -> i16 {
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
pub(super) struct Contours {
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

    pub(super) fn finish(mut self) -> BezPath {
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
