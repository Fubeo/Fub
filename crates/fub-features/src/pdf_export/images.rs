//! I vettori e le immagini del PDF.
//!
//! Passano tutti da `svg2pdf`, che li scrive come oggetti `XObject`: un
//! vettore resta vettore (il suo testo resta testo, coi caratteri di serie di
//! Fub), un JPEG resta il suo JPEG, un PNG tiene la sua trasparenza.
//!
//! Con le immagini [alleggerite](QualitaImmagini::Alleggerite), un'immagine
//! più fitta di [`PUNTI_ALLEGGERITI`] punti per pollice, alla misura in cui sta
//! sulla pagina, si riduce a quella risoluzione e si ricomprime: JPEG se è
//! opaca, PNG se ha trasparenza. Se il risultato non pesa meno, o se
//! l'immagine non si sa ridurre (una GIF, un file che non si decodifica, una
//! troppo grande da aprire), resta quella di prima: alleggerire non toglie
//! mai un'immagine.

use std::collections::HashMap;
use std::io::Cursor;

use base64::Engine as _;
use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ImageFormat, RgbaImage};
use pdf_writer::{Chunk, Ref};
use svg2pdf::usvg;

use super::writer::{QualitaImmagini, Scrittore};
use super::{Avviso, MAX_IMMAGINE_BYTE};
use crate::draw::per_il_pdf;

/// La risoluzione delle immagini alleggerite, in punti per pollice: quella che
/// una stampa d'ufficio legge senza vedere i pixel.
pub(super) const PUNTI_ALLEGGERITI: f64 = 150.0;

/// I pixel CSS in un pollice.
const PIXEL_PER_POLLICE: f64 = 96.0;

/// La qualità del JPEG di un'immagine alleggerita.
const QUALITA_JPEG: u8 = 80;

/// Oltre questi pixel un'immagine non si apre per ridurla: resta com'è.
const MAX_PIXEL_DA_RIDURRE: u64 = 100_000_000;

impl Scrittore<'_> {
    pub(super) fn vettore(&mut self, svg: &str) -> Option<Ref> {
        // Il testo del vettore (le etichette di un diagramma) resta testo, coi
        // caratteri di serie di Fub, che sono quelli dei diagrammi; `svg2pdf`
        // li incorpora in sotto-insieme.
        let opzioni = usvg::Options {
            fontdb: per_il_pdf::caratteri_di_serie(),
            ..usvg::Options::default()
        };
        let albero = match usvg::Tree::from_str(svg, &opzioni) {
            Ok(albero) => albero,
            Err(errore) => {
                self.avvisi.push(Avviso::VettoreIlleggibile {
                    motivo: errore.to_string(),
                });
                return None;
            }
        };
        match self.innesta(&albero) {
            Ok(rif) => Some(rif),
            Err(motivo) => {
                self.avvisi.push(Avviso::VettoreIlleggibile { motivo });
                None
            }
        }
    }

    /// L'immagine `file`, grande `w` × `h` pixel CSS sulla pagina. Una che
    /// manca, non si legge o pesa troppo lascia il suo posto vuoto e un
    /// avviso: il resto del PDF si scrive.
    pub(super) fn immagine(&mut self, file: &str, w: f64, h: f64) -> Option<Ref> {
        let mancante = |s: &mut Self| {
            s.avvisi
                .push(Avviso::ImmagineMancante { file: file.into() });
            None
        };
        let Some(letti) = self.risorse.immagine(file) else {
            return mancante(self);
        };
        if letti.len() > MAX_IMMAGINE_BYTE {
            self.avvisi.push(Avviso::ImmagineTroppoGrande {
                file: file.into(),
                byte: letti.len() as u64,
            });
            return None;
        }
        let Some(tipo) = tipo_immagine(&letti) else {
            return mancante(self);
        };
        let (byte, tipo) = match self.opzioni.immagini {
            QualitaImmagini::Piene => (letti, tipo),
            QualitaImmagini::Alleggerite => match alleggerisci(&letti, tipo, w, h) {
                Some((ridotta, tipo)) => (ridotta, tipo),
                None => (letti, tipo),
            },
        };
        // Un `<image>` in un SVG grande quanto il riquadro: `svg2pdf` tiene
        // il JPEG com'è e scrive il PNG con la sua trasparenza.
        let dati = base64::engine::general_purpose::STANDARD.encode(&byte);
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" \
             viewBox=\"0 0 {w} {h}\"><image width=\"{w}\" height=\"{h}\" \
             preserveAspectRatio=\"none\" href=\"data:{tipo};base64,{dati}\"/></svg>"
        );
        let Ok(albero) = usvg::Tree::from_str(&svg, &usvg::Options::default()) else {
            return mancante(self);
        };
        if !albero.root().has_children() {
            return mancante(self);
        }
        // Un file che comincia come un PNG e poi si rompe arriva fin qui: per
        // chi legge l'avviso è un'immagine che non si legge.
        match self.innesta(&albero) {
            Ok(rif) => Some(rif),
            Err(_) => mancante(self),
        }
    }

    /// Un albero di `usvg` come `XObject` del PDF, coi riferimenti rinumerati
    /// dopo quelli già scritti; se `svg2pdf` non lo sa scrivere, il perché.
    fn innesta(&mut self, albero: &usvg::Tree) -> Result<Ref, String> {
        let (pezzo, rif) = svg2pdf::to_chunk(albero, svg2pdf::ConversionOptions::default())
            .map_err(|errore| errore.to_string())?;
        let mut mappa: HashMap<Ref, Ref> = HashMap::new();
        let mut prossimo = self.prossimo;
        let rinumerato: Chunk = pezzo.renumber(|vecchio| {
            *mappa.entry(vecchio).or_insert_with(|| {
                let r = Ref::new(prossimo);
                prossimo += 1;
                r
            })
        });
        self.prossimo = prossimo;
        self.pdf.extend(&rinumerato);
        mappa
            .get(&rif)
            .copied()
            .ok_or_else(|| "svg2pdf did not write the object".to_owned())
    }
}

/// L'immagine ridotta a [`PUNTI_ALLEGGERITI`] alla misura `w` × `h` (pixel
/// CSS) e ricompressa, col suo tipo; `None` se resta quella di prima: già
/// abbastanza leggera, di un tipo che non si riduce, illeggibile, o se la
/// riduzione non pesa meno.
pub(super) fn alleggerisci(
    byte: &[u8],
    tipo: &'static str,
    w: f64,
    h: f64,
) -> Option<(Vec<u8>, &'static str)> {
    if tipo == "image/gif" {
        // Una GIF può muoversi, e pesa già poco: resta com'è.
        return None;
    }
    let misura = imagesize::blob_size(byte).ok()?;
    let (larga, alta) = (misura.width as u64, misura.height as u64);
    if larga == 0 || alta == 0 || larga.saturating_mul(alta) > MAX_PIXEL_DA_RIDURRE {
        return None;
    }
    let scala = PUNTI_ALLEGGERITI / PIXEL_PER_POLLICE;
    let voluta_w = (w * scala).ceil().max(1.0) as u64;
    let voluta_h = (h * scala).ceil().max(1.0) as u64;
    if larga <= voluta_w && alta <= voluta_h {
        return None;
    }
    // Le proporzioni dell'immagine, non del riquadro: la vista la stira, il
    // PDF la stirerà allo stesso modo.
    let fattore = (voluta_w as f64 / larga as f64)
        .max(voluta_h as f64 / alta as f64)
        .min(1.0);
    let nuova_w = ((larga as f64 * fattore).round() as u32).max(1);
    let nuova_h = ((alta as f64 * fattore).round() as u32).max(1);
    let pixel = decodifica(byte, tipo)?;
    let ridotta = image::imageops::resize(&pixel, nuova_w, nuova_h, FilterType::CatmullRom);
    let opaca = ridotta.pixels().all(|p| p.0[3] == 255);
    let (nuovi, nuovo_tipo) = if opaca {
        (jpeg(&ridotta)?, "image/jpeg")
    } else {
        (png(&ridotta)?, "image/png")
    };
    (nuovi.len() < byte.len()).then_some((nuovi, nuovo_tipo))
}

/// I pixel di un'immagine, in RGBA a 8 bit.
fn decodifica(byte: &[u8], tipo: &str) -> Option<RgbaImage> {
    match tipo {
        "image/png" => {
            let mut decoder = png::Decoder::new(Cursor::new(byte));
            decoder.set_transformations(png::Transformations::normalize_to_color8());
            let mut lettore = decoder.read_info().ok()?;
            let mut buffer = vec![0; lettore.output_buffer_size()?];
            let info = lettore.next_frame(&mut buffer).ok()?;
            buffer.truncate(info.buffer_size());
            let (w, h) = (info.width, info.height);
            let rgba: Vec<u8> = match info.color_type {
                png::ColorType::Rgba => buffer,
                png::ColorType::Rgb => buffer
                    .chunks_exact(3)
                    .flat_map(|p| [p[0], p[1], p[2], 255])
                    .collect(),
                png::ColorType::GrayscaleAlpha => buffer
                    .chunks_exact(2)
                    .flat_map(|p| [p[0], p[0], p[0], p[1]])
                    .collect(),
                png::ColorType::Grayscale => buffer.iter().flat_map(|&g| [g, g, g, 255]).collect(),
                // `normalize_to_color8` espande la tavolozza: qui non arriva.
                png::ColorType::Indexed => return None,
            };
            RgbaImage::from_raw(w, h, rgba)
        }
        "image/jpeg" => image::load_from_memory_with_format(byte, ImageFormat::Jpeg)
            .ok()
            .map(|i| i.to_rgba8()),
        "image/webp" => image::load_from_memory_with_format(byte, ImageFormat::WebP)
            .ok()
            .map(|i| i.to_rgba8()),
        _ => None,
    }
}

fn jpeg(pixel: &RgbaImage) -> Option<Vec<u8>> {
    let rgb = image::DynamicImage::ImageRgba8(pixel.clone()).to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, QUALITA_JPEG)
        .encode_image(&rgb)
        .ok()?;
    Some(out)
}

fn png(pixel: &RgbaImage) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, pixel.width(), pixel.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(png::Compression::High);
        let mut scrittore = encoder.write_header().ok()?;
        scrittore.write_image_data(pixel.as_raw()).ok()?;
        scrittore.finish().ok()?;
    }
    Some(out)
}

/// Il tipo di un'immagine dai suoi primi byte: solo quelli che `usvg` sa
/// leggere.
pub(super) fn tipo_immagine(byte: &[u8]) -> Option<&'static str> {
    if byte.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if byte.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if byte.starts_with(b"GIF8") {
        Some("image/gif")
    } else if byte.len() > 12 && &byte[..4] == b"RIFF" && &byte[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
