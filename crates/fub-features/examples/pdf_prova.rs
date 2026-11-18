//! La prova del motore del PDF delle note (ADR 0247), dal lato del core.
//!
//!     cargo run -p fub-features --features draw --release \
//!         --example pdf_prova -- <cartella> <scala>
//!
//! Il banco (`apps/client/bench/pdf-prova.mjs`) lascia nella cartella
//! l'elenco delle pagine che la vista ha misurato (`elenco.json`) e dove
//! stanno i file che nomina (`risorse.json`). Qui si scrive il PDF
//! (`nota.pdf`), si ridisegna ogni pagina con `hayro` alla scala delle foto
//! della vista (`pdf-<n>.png`) e se ne estrae il testo con `lopdf`
//! (`testo-pdf.json`); `misure.json` dice quanto ci è voluto e quanto pesa.
//! Il confronto con le foto della vista lo fa il banco.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use fub_features::pdf_export::{scrivi, ElencoPagine, Risorse};
use serde::Deserialize;

#[derive(Deserialize)]
struct Mappa {
    caratteri: BTreeMap<String, PathBuf>,
    immagini: BTreeMap<String, PathBuf>,
}

impl Risorse for Mappa {
    fn carattere(&self, file: &str) -> Option<Vec<u8>> {
        std::fs::read(self.caratteri.get(file)?).ok()
    }
    fn immagine(&self, file: &str) -> Option<Vec<u8>> {
        std::fs::read(self.immagini.get(file)?).ok()
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let cartella = PathBuf::from(args.next().ok_or("manca la cartella")?);
    let scala: f32 = args.next().as_deref().unwrap_or("1").parse()?;

    let json = std::fs::read(cartella.join("elenco.json"))?;
    let mappa: Mappa = serde_json::from_slice(&std::fs::read(cartella.join("risorse.json"))?)?;

    let t = Instant::now();
    let elenco: ElencoPagine = serde_json::from_slice(&json)?;
    let lettura_ms = t.elapsed().as_secs_f64() * 1000.0;

    let t = Instant::now();
    let scritto = scrivi(&elenco, &mappa)?;
    let scrittura_ms = t.elapsed().as_secs_f64() * 1000.0;
    std::fs::write(cartella.join("nota.pdf"), &scritto.pdf)?;

    let t = Instant::now();
    let pagine = ridisegna(&scritto.pdf, scala, &cartella)?;
    let ridisegno_ms = t.elapsed().as_secs_f64() * 1000.0;

    let doc = lopdf::Document::load_mem(&scritto.pdf)?;
    let mut testi = Vec::new();
    for n in doc.get_pages().keys() {
        testi.push(doc.extract_text(&[*n])?);
    }
    std::fs::write(
        cartella.join("testo-pdf.json"),
        serde_json::to_vec_pretty(&testi)?,
    )?;

    let misure = serde_json::json!({
        "pagine": pagine,
        "elenco_byte": json.len(),
        "pdf_byte": scritto.pdf.len(),
        "lettura_json_ms": lettura_ms,
        "scrittura_pdf_ms": scrittura_ms,
        "ridisegno_hayro_ms": ridisegno_ms,
        "avvisi": scritto.avvisi,
    });
    std::fs::write(
        cartella.join("misure.json"),
        serde_json::to_vec_pretty(&misure)?,
    )?;
    println!("{}", serde_json::to_string(&misure)?);
    Ok(())
}

/// Ogni pagina del PDF ridisegnata da `hayro` a `scala` pixel per pixel CSS,
/// su fondo bianco, in `pdf-<n>.png`.
fn ridisegna(pdf: &[u8], scala: f32, cartella: &Path) -> Result<usize, Box<dyn std::error::Error>> {
    use hayro::hayro_interpret::InterpreterSettings;
    use hayro::hayro_syntax::Pdf;
    let pdf = Pdf::new(Arc::new(pdf.to_vec())).map_err(|_| "hayro non legge il PDF")?;
    let pagine = pdf.pages();
    for (n, pagina) in pagine.iter().enumerate() {
        let (w, h) = pagina.render_dimensions();
        // Un punto è 4/3 di pixel CSS.
        let lw = (w / 0.75 * scala).round() as u32;
        let lh = (h / 0.75 * scala).round() as u32;
        let render = hayro::RenderSettings {
            x_scale: lw as f32 / w,
            y_scale: lh as f32 / h,
            width: Some(u16::try_from(lw)?),
            height: Some(u16::try_from(lh)?),
            bg_color: hayro::vello_cpu::color::palette::css::WHITE,
        };
        let pixmap = hayro::render(
            pagina,
            &hayro::RenderCache::new(),
            &InterpreterSettings::default(),
            &render,
        );
        let file = std::fs::File::create(cartella.join(format!("pdf-{}.png", n + 1)))?;
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), lw, lh);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()?
            .write_image_data(pixmap.data_as_u8_slice())?;
    }
    Ok(pagine.len())
}
