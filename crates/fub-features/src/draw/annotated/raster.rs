//! Una pagina come immagine, per la redazione.
//!
//! La pagina si disegna con `hayro` e le annotazioni sopra con `resvg`, nella
//! stessa immagine: nel PDF redatto la pagina è soltanto quell'immagine, e il
//! testo che le coperture nascondono non c'è più, nemmeno sotto.
//!
//! `hayro` non legge la pagina come pdf.js: prende A4 per una `MediaBox` che
//! manca, non interseca la `CropBox` vuota, ignora `UserUnit` e una rotazione
//! negativa, salta una pagina senza contenuto, e dei livelli conosce solo la
//! configurazione di serie dei gruppi. Per questo non disegna la pagina del
//! PDF originale ma una copia normalizzata in un PDF di una pagina sola: la
//! vista di pdf.js come `MediaBox`, la rotazione già ridotta, niente
//! `UserUnit` (la scala la mette chi disegna), le annotazioni del PDF già nel
//! contenuto come le mostra l'editor ([`super::redact::body`]) e i livelli
//! già decisi ([`Layers`]): un livello spento entra nell'elenco `/OFF`, che
//! `hayro` rispetta, e uno XObject con un `/OC` spento, che `hayro` non
//! guarda, diventa un disegno vuoto.

use std::collections::BTreeMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex};

use flate2::write::ZlibEncoder;
use flate2::Compression;
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use resvg::tiny_skia::{IntSize, Pixmap, Transform};
use resvg::usvg::Tree;

use super::copy::{Copier, DOCUMENT};
use super::geometry::Geometry;
use super::layers::Layers;
use super::page::real;
use super::redact::body;
use crate::draw::{AREA_MAX, SIDE_MAX};

/// Un'immagine pronta per il PDF: righe filtrate come un PNG e compresse.
pub(super) struct Image {
    pub(super) width: u32,
    pub(super) height: u32,
    /// Vero se l'immagine è in scala di grigi: un canale invece di tre.
    pub(super) gray: bool,
    pub(super) data: Vec<u8>,
}

impl Image {
    /// Lo XObject dell'immagine.
    pub(super) fn xobject(self) -> Stream {
        let colors = if self.gray { 1 } else { 3 };
        let dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => i64::from(self.width),
            "Height" => i64::from(self.height),
            "ColorSpace" => if self.gray { "DeviceGray" } else { "DeviceRGB" },
            "BitsPerComponent" => 8,
            "Filter" => "FlateDecode",
            "DecodeParms" => dictionary! {
                "Predictor" => 15,
                "Colors" => colors,
                "BitsPerComponent" => 8,
                "Columns" => i64::from(self.width),
            },
        };
        Stream::new(dict, self.data).with_compression(false)
    }
}

/// Com'è andato il disegno di una pagina.
pub(super) struct Rendered {
    pub(super) image: Image,
    /// I punti per pollice dell'immagine: quelli chiesti, o meno se la pagina
    /// ci sta solo così nei limiti dei pixel.
    pub(super) dpi: f64,
    /// Vero se `hayro` ha detto di non aver saputo disegnare un carattere o
    /// un'immagine della pagina.
    pub(super) incomplete: bool,
    /// Le annotazioni del PDF disegnate dentro la pagina.
    pub(super) flattened: usize,
    /// Le annotazioni del PDF senza un aspetto scritto, che mancano.
    pub(super) unshown: usize,
}

/// Disegna la pagina `page` di `doc` a `dpi` punti per pollice, con i livelli
/// `layers` e le annotazioni di `overlay` sopra.
pub(super) fn render(
    doc: &Document,
    page: ObjectId,
    geometry: &Geometry,
    layers: &Layers,
    overlay: Option<&Tree>,
    dpi: f64,
) -> Result<Rendered, String> {
    let (width, height) = geometry.size();
    let scale = fitting(width, height, dpi / 72.0);
    let (pixels_w, pixels_h) = (
        (width * scale).round().max(1.0) as u32,
        (height * scale).round().max(1.0) as u32,
    );

    let (single, flattened, unshown) = single_page(doc, page, geometry, layers)?;
    let incomplete = Arc::new(Mutex::new(false));
    let drawn = {
        let incomplete = Arc::clone(&incomplete);
        catch_unwind(AssertUnwindSafe(move || {
            draw_page(single, pixels_w, pixels_h, incomplete)
        }))
        .map_err(|_| "the page could not be rendered".to_string())??
    };
    let mut pixmap = Pixmap::from_vec(
        drawn,
        IntSize::from_wh(pixels_w, pixels_h).ok_or_else(|| "the page has no pixels".to_string())?,
    )
    .ok_or_else(|| "the page could not be rendered".to_string())?;
    if let Some(tree) = overlay {
        let transform = Transform::from_scale(
            (f64::from(pixels_w) / width) as f32,
            (f64::from(pixels_h) / height) as f32,
        );
        resvg::render(tree, transform, &mut pixmap.as_mut());
    }
    let incomplete = *incomplete
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(Rendered {
        image: encode(&pixmap),
        dpi: scale * 72.0,
        incomplete,
        flattened,
        unshown,
    })
}

/// La scala, in pixel per punto, a cui la pagina sta nei limiti dei pixel:
/// quella chiesta, o la più grande sotto di lei.
fn fitting(width: f64, height: f64, asked: f64) -> f64 {
    let (side, area) = (f64::from(SIDE_MAX), f64::from(AREA_MAX));
    let fits = |scale: f64| {
        let (w, h) = ((width * scale).round(), (height * scale).round());
        w <= side && h <= side && w * h <= area
    };
    if fits(asked) {
        return asked;
    }
    let mut scale = (side / width)
        .min(side / height)
        .min((area / (width * height)).sqrt())
        .min(asked);
    while !fits(scale) && scale > 0.0 {
        scale *= 0.999;
    }
    scale
}

/// Il PDF di una pagina sola che `hayro` disegna come pdf.js la mostra, con
/// quante annotazioni del PDF ha dentro e quante mancano.
fn single_page(
    doc: &Document,
    page: ObjectId,
    geometry: &Geometry,
    layers: &Layers,
) -> Result<(Vec<u8>, usize, usize), String> {
    let mut single = Document::with_version("1.7");
    let pages = single.new_object_id();
    let new_page = single.new_object_id();
    let mut copier = Copier::new(doc, &DOCUMENT);
    copier.seed(page, new_page);
    let body = body(&mut copier, layers, page, &mut single);
    let (flattened, unshown) = (body.flattened, body.unshown);
    let (resources, contents) = body.finish(&mut single);
    let mut dict = dictionary! {
        "Type" => "Page",
        "Parent" => pages,
        "MediaBox" => geometry.view.iter().map(|v| real(*v)).collect::<Vec<_>>(),
        "Rotate" => i64::from(geometry.rotate),
        "Resources" => resources,
        "Contents" => contents,
    };
    if let Ok(group) = doc.get_dictionary(page).and_then(|d| d.get(b"Group")) {
        let group = copier.value(group, &mut single);
        dict.set("Group", group);
    }
    copier.finish(&mut single);

    let copied: BTreeMap<ObjectId, ObjectId> = copier.copied().collect();
    let hidden: Vec<Object> = layers
        .hidden(doc, copied.keys().copied())
        .map(|old| Object::Reference(copied[&old]))
        .collect();
    for (old, new) in &copied {
        let Ok(Object::Stream(stream)) = doc.get_object(*old) else {
            continue;
        };
        let drawn = matches!(
            stream.dict.get(b"Subtype").and_then(Object::as_name),
            Ok(b"Form" | b"Image")
        );
        let shown = stream
            .dict
            .get(b"OC")
            .map_or(true, |oc| layers.visible(doc, oc));
        if drawn && !shown {
            single.objects.insert(
                *new,
                Object::Stream(Stream::new(
                    dictionary! {
                        "Type" => "XObject",
                        "Subtype" => "Form",
                        "BBox" => vec![Object::Integer(0), 0.into(), 0.into(), 0.into()],
                    },
                    Vec::new(),
                )),
            );
        }
    }

    single.objects.insert(new_page, Object::Dictionary(dict));
    single.objects.insert(
        pages,
        Object::Dictionary(
            dictionary! { "Type" => "Pages", "Kids" => vec![new_page.into()], "Count" => 1 },
        ),
    );
    let mut catalog = dictionary! { "Type" => "Catalog", "Pages" => pages };
    if !hidden.is_empty() {
        catalog.set(
            "OCProperties",
            dictionary! { "OCGs" => hidden.clone(), "D" => dictionary! { "OFF" => hidden } },
        );
    }
    let catalog = single.add_object(catalog);
    single.trailer.set("Root", catalog);
    let mut out = Vec::new();
    single
        .save_to(&mut out)
        .map_err(|error| format!("the page could not be prepared for rendering: {error}"))?;
    Ok((out, flattened, unshown))
}

/// Disegna la prima pagina di `pdf` in una pixmap premoltiplicata di
/// `width` × `height`, su fondo bianco.
fn draw_page(
    pdf: Vec<u8>,
    width: u32,
    height: u32,
    incomplete: Arc<Mutex<bool>>,
) -> Result<Vec<u8>, String> {
    use hayro::hayro_interpret::InterpreterSettings;
    use hayro::hayro_syntax::Pdf;

    let pdf = Pdf::new(Arc::new(pdf))
        .map_err(|_| "the page could not be read for rendering".to_string())?;
    let pages = pdf.pages();
    let page = pages
        .first()
        .ok_or_else(|| "the page could not be read for rendering".to_string())?;
    let (rendered_w, rendered_h) = page.render_dimensions();
    let settings = InterpreterSettings {
        warning_sink: Arc::new(move |_| {
            *incomplete
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
        }),
        // Le annotazioni sono già nel contenuto, con le regole di chi le
        // mostra: lo stato scelto di un campo, le annotazioni nascoste.
        render_annotations: false,
        ..InterpreterSettings::default()
    };
    let render = hayro::RenderSettings {
        x_scale: width as f32 / rendered_w,
        y_scale: height as f32 / rendered_h,
        width: Some(u16::try_from(width).map_err(|_| "the page is too large".to_string())?),
        height: Some(u16::try_from(height).map_err(|_| "the page is too large".to_string())?),
        bg_color: hayro::vello_cpu::color::palette::css::WHITE,
    };
    let pixmap = hayro::render(page, &settings, &render);
    Ok(pixmap.data_as_u8_slice().to_vec())
}

/// L'immagine della pixmap, opaca: in grigio se tutti i pixel lo sono, con
/// ogni riga filtrata come in un PNG (il filtro che dà i byte più piccoli) e
/// compressa con Flate.
fn encode(pixmap: &Pixmap) -> Image {
    let (width, height) = (pixmap.width(), pixmap.height());
    let pixels = pixmap.pixels();
    // Il fondo è bianco e opaco: un pixel trasparente non c'è, ma se ci fosse
    // starebbe sul bianco.
    let color = |p: &resvg::tiny_skia::PremultipliedColorU8| {
        let white = 255 - p.alpha();
        [p.red() + white, p.green() + white, p.blue() + white]
    };
    let gray = pixels.iter().all(|p| {
        let [r, g, b] = color(p);
        r == g && g == b
    });
    let channels = if gray { 1 } else { 3 };
    let stride = width as usize * channels;
    let mut previous = vec![0u8; stride];
    let mut row = Vec::with_capacity(stride);
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    let mut candidates: [Vec<u8>; 5] = Default::default();
    for line in pixels.chunks(width as usize) {
        row.clear();
        for pixel in line {
            let [r, g, b] = color(pixel);
            if gray {
                row.push(r);
            } else {
                row.extend_from_slice(&[r, g, b]);
            }
        }
        let best = filter(&row, &previous, channels, &mut candidates);
        std::io::Write::write_all(&mut encoder, &[best as u8])
            .and_then(|()| std::io::Write::write_all(&mut encoder, &candidates[best]))
            .expect("scrivere in un vettore non fallisce");
        std::mem::swap(&mut previous, &mut row);
    }
    Image {
        width,
        height,
        gray,
        data: encoder
            .finish()
            .expect("scrivere in un vettore non fallisce"),
    }
}

/// I cinque filtri del PNG sulla riga `row`, con `above` la riga sopra; il
/// risultato è il filtro con la somma dei valori assoluti più piccola, la
/// scelta di libpng.
fn filter(row: &[u8], above: &[u8], bpp: usize, out: &mut [Vec<u8>; 5]) -> usize {
    for candidate in out.iter_mut() {
        candidate.clear();
    }
    for (i, &x) in row.iter().enumerate() {
        let a = if i >= bpp { row[i - bpp] } else { 0 };
        let b = above[i];
        let c = if i >= bpp { above[i - bpp] } else { 0 };
        out[0].push(x);
        out[1].push(x.wrapping_sub(a));
        out[2].push(x.wrapping_sub(b));
        out[3].push(x.wrapping_sub(((u16::from(a) + u16::from(b)) / 2) as u8));
        out[4].push(x.wrapping_sub(paeth(a, b, c)));
    }
    let cost = |bytes: &[u8]| -> u64 {
        bytes
            .iter()
            .map(|&v| u64::from((v as i8).unsigned_abs()))
            .sum()
    };
    (0..5).min_by_key(|&i| cost(&out[i])).unwrap_or(0)
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let (a16, b16, c16) = (i16::from(a), i16::from(b), i16::from(c));
    let p = a16 + b16 - c16;
    let (pa, pb, pc) = ((p - a16).abs(), (p - b16).abs(), (p - c16).abs());
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::ZlibDecoder;
    use std::io::Read as _;

    /// Toglie i filtri del PNG: il contrario di [`encode`].
    fn unfilter(image: &Image) -> Vec<u8> {
        let channels = if image.gray { 1 } else { 3 };
        let stride = image.width as usize * channels;
        let mut raw = Vec::new();
        ZlibDecoder::new(image.data.as_slice())
            .read_to_end(&mut raw)
            .unwrap();
        let mut out: Vec<u8> = Vec::new();
        let mut previous = vec![0u8; stride];
        for line in raw.chunks(stride + 1) {
            let (kind, data) = (line[0], &line[1..]);
            let mut row = vec![0u8; stride];
            for i in 0..stride {
                let a = if i >= channels { row[i - channels] } else { 0 };
                let b = previous[i];
                let c = if i >= channels {
                    previous[i - channels]
                } else {
                    0
                };
                row[i] = data[i].wrapping_add(match kind {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
                    _ => paeth(a, b, c),
                });
            }
            out.extend_from_slice(&row);
            previous = row;
        }
        out
    }

    #[test]
    fn the_filters_round_trip_in_gray_and_in_color() {
        let mut pixmap = Pixmap::new(7, 5).unwrap();
        pixmap.fill(resvg::tiny_skia::Color::WHITE);
        let gray = encode(&pixmap);
        assert!(gray.gray);
        assert_eq!(unfilter(&gray), vec![255; 35]);

        for (i, pixel) in pixmap.pixels_mut().iter_mut().enumerate() {
            let v = (i * 37 % 256) as u8;
            *pixel =
                resvg::tiny_skia::PremultipliedColorU8::from_rgba(v, 255 - v, v / 2, 255).unwrap();
        }
        let color = encode(&pixmap);
        assert!(!color.gray);
        let expected: Vec<u8> = (0..35)
            .flat_map(|i| {
                let v = (i * 37 % 256) as u8;
                [v, 255 - v, v / 2]
            })
            .collect();
        assert_eq!(unfilter(&color), expected);
    }

    #[test]
    fn a_huge_page_is_rendered_at_the_scale_that_fits() {
        assert_eq!(fitting(595.0, 842.0, 200.0 / 72.0), 200.0 / 72.0);
        let scale = fitting(14_400.0, 14_400.0, 600.0 / 72.0);
        let side = (14_400.0 * scale).round();
        assert!(side <= f64::from(SIDE_MAX) && side * side <= f64::from(AREA_MAX));
    }
}
