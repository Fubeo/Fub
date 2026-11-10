//! La scrittura dei file: PNG e JPEG, SVG e PDF.

use super::*;

// ---------------------------------------------------------------------------
// PNG e JPEG
// ---------------------------------------------------------------------------

/// Scrive l'immagine di un file in PNG o in JPEG, alla misura `size`.
pub(super) fn write_raster(
    drawing: &mut Drawing<'_>,
    file: &File<'_>,
    size: Size,
    format: Format,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let page = &file.pages[0];
    let tree = match drawing.tree(&page.text) {
        Ok(tree) => tree,
        Err(reason) => return Ok(Outcome::Failed(reason)),
    };
    let side = tree.size();
    let measured = measure(side.width(), side.height(), size);
    let (width, height, scale) = (measured.width, measured.height, measured.scale);
    let Some(mut pixmap) = Pixmap::new(width.max(1), height.max(1)) else {
        return Ok(Outcome::Failed(format!(
            "the drawing is too large to rasterize ({width} × {height} pixels)"
        )));
    };
    if measured.reduced {
        let instead = match size {
            Size::Scale(asked) => format!("at scale {scale:.2} instead of {asked}"),
            Size::Pixels(asked) => format!("{width} pixels wide instead of {asked}"),
        };
        let what = match size {
            Size::Scale(_) => "scale",
            Size::Pixels(_) => "width",
        };
        report.log.push(
            TransferNote::warning(format!(
                "{}exported {instead}: at the requested {what} the image would exceed {SIDE_MAX} pixels per side or {} million pixels",
                file.about(),
                AREA_MAX / 1_048_576,
            ))
            .about(drawing.doc.to_string()),
        );
    }
    resvg::render(
        &tree,
        Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    drop(tree);

    match format {
        Format::Jpeg => deliver(out, &file.path, "image/jpeg", report, |sink| {
            encode_jpeg(&pixmap, scale, sink)
        })?,
        _ => deliver(out, &file.path, "image/png", report, |sink| {
            encode_png(&pixmap, scale, &drawing.title, sink)
        })?,
    }
    Ok(Outcome::Done)
}

/// Apre l'artefatto `path`, ci scrive quello che `encode` scrive, e lo
/// consegna. L'errore del sink resta il suo; quello dell'encoder è un
/// [`E_WRITE`].
fn deliver<E: std::fmt::Display>(
    out: &mut dyn ArtifactSink,
    path: &str,
    media_type: &str,
    report: &mut ExportReport,
    encode: impl FnOnce(&mut SinkWriter<'_>) -> Result<(), E>,
) -> Result<(), PluginError> {
    let handle = out.open_artifact(path, media_type)?;
    let mut sink = SinkWriter {
        out,
        handle,
        failure: None,
    };
    let encoded = encode(&mut sink);
    let SinkWriter { out, failure, .. } = sink;
    if let Some(failure) = failure {
        return Err(failure);
    }
    encoded.map_err(|error| {
        PluginError::Internal(Text::message(
            E_WRITE,
            vec![
                Arg::text("path", path.to_string()),
                Arg::text("reason", error.to_string()),
            ],
        ))
    })?;
    report.artifacts.push(out.close_artifact(handle)?);
    Ok(())
}

/// Scrive il PNG a righe, dritto nel sink: la pixmap è già in memoria, una
/// seconda copia compressa non serve.
fn encode_png(
    pixmap: &Pixmap,
    scale: f32,
    title: &str,
    sink: &mut SinkWriter<'_>,
) -> Result<(), png::EncodingError> {
    let buffered = BufWriter::with_capacity(CHUNK, sink);
    let mut encoder = png::Encoder::new(buffered, pixmap.width(), pixmap.height());
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
    // La densità: `scale` pixel per pixel CSS, che è 1/96 di pollice.
    let per_meter = (CSS_DPI * scale / 0.0254).round() as u32;
    encoder.set_pixel_dims(Some(png::PixelDimensions {
        xppu: per_meter,
        yppu: per_meter,
        unit: png::Unit::Meter,
    }));
    encoder.add_itxt_chunk("Title".to_string(), title.to_string())?;
    encoder.add_itxt_chunk("Software".to_string(), "Fub".to_string())?;
    let mut writer = encoder.write_header()?;
    {
        let mut stream = writer.stream_writer()?;
        let mut row = Vec::with_capacity(pixmap.width() as usize * 4);
        for line in pixmap.pixels().chunks(pixmap.width() as usize) {
            row.clear();
            for pixel in line {
                // La pixmap è premoltiplicata, il PNG no.
                let color = pixel.demultiply();
                row.extend_from_slice(&[color.red(), color.green(), color.blue(), color.alpha()]);
            }
            stream.write_all(&row)?;
        }
        stream.finish()?;
    }
    // `finish` scrive la chiusura e lascia andare il buffer, che si svuota nel
    // sink: un errore lì resta in `SinkWriter::failure`, che chi chiama legge.
    writer.finish()
}

/// Scrive il JPEG dritto nel sink. L'encoder di `image` legge i pixel a
/// blocchi di 8 × 8 da [`OnWhite`], quindi l'immagine sul bianco non si
/// copia; scrive il colore senza sottocampionarlo (4:4:4), e dei segmenti
/// facoltativi soltanto il JFIF con la densità.
fn encode_jpeg(pixmap: &Pixmap, scale: f32, sink: &mut SinkWriter<'_>) -> Result<(), String> {
    let mut buffered = BufWriter::with_capacity(CHUNK, sink);
    let mut encoder = JpegEncoder::new_with_quality(&mut buffered, JPEG_QUALITY);
    // I punti per pollice: `scale` pixel per pixel CSS. Il JFIF li scrive
    // interi; una densità che non ci sta resta non detta, che è meglio di una
    // sbagliata.
    let dpi = (CSS_DPI * scale).round();
    if (1.0..=f32::from(u16::MAX)).contains(&dpi) {
        encoder.set_pixel_density(PixelDensity::dpi(dpi as u16));
    }
    encoder
        .encode_image(&OnWhite(pixmap))
        .map_err(|error| error.to_string())?;
    buffered.flush().map_err(|error| error.to_string())
}

/// La pixmap posata sul bianco, come `image` legge un'immagine: ciò che è
/// trasparente diventa bianco, ciò che è velato si schiarisce.
struct OnWhite<'p>(&'p Pixmap);

impl GenericImageView for OnWhite<'_> {
    type Pixel = Rgb<u8>;

    fn dimensions(&self) -> (u32, u32) {
        (self.0.width(), self.0.height())
    }

    fn get_pixel(&self, x: u32, y: u32) -> Rgb<u8> {
        // Premoltiplicato, il colore sopra il bianco è `c + (255 - a)`: un
        // canale non supera mai la sua alfa, quindi la somma sta in un byte.
        let pixel = self
            .0
            .pixel(x, y)
            .expect("l'encoder legge dentro l'immagine");
        let white = 255 - pixel.alpha();
        Rgb([
            pixel.red().saturating_add(white),
            pixel.green().saturating_add(white),
            pixel.blue().saturating_add(white),
        ])
    }
}

/// Un [`ArtifactSink`] visto come `io::Write`, per l'encoder. L'errore del
/// sink resta qui, tipizzato, invece di diventare un `io::Error` qualunque.
struct SinkWriter<'a> {
    out: &'a mut dyn ArtifactSink,
    handle: ArtifactHandle,
    failure: Option<PluginError>,
}

impl Write for SinkWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self.out.write_artifact(self.handle, bytes) {
            Ok(()) => Ok(bytes.len()),
            Err(error) => {
                let message = error.to_string();
                self.failure.get_or_insert(error);
                Err(io::Error::other(message))
            }
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

pub(super) fn write_svg(
    drawing: &mut Drawing<'_>,
    file: &File<'_>,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let page = &file.pages[0];
    let Ok(text) = std::str::from_utf8(&page.text) else {
        return Ok(Outcome::Failed(not_utf8()));
    };
    let cleaned = match clean(text, &page.scope) {
        Ok(cleaned) => cleaned,
        Err(error) => return Ok(Outcome::Failed(unreadable(&error))),
    };
    // Il testo c'è comunque; le immagini, finché il file ci sta.
    let mut room = drawing.room.saturating_sub(cleaned.len());
    let cleaned = match embed_images(&cleaned, |href| drawing.embed(href, &mut room)) {
        Ok(embedded) => embedded,
        Err(error) => return Ok(Outcome::Failed(unreadable(&error))),
    };
    let handle = out.open_artifact(&file.path, "image/svg+xml")?;
    for piece in cleaned.as_bytes().chunks(CHUNK) {
        out.write_artifact(handle, piece)?;
    }
    report.artifacts.push(out.close_artifact(handle)?);
    drawing.room = drawing.room.saturating_sub(cleaned.len());
    Ok(Outcome::Done)
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/// Il PDF di `file`, una pagina per pagina, sulla pagina di stampa `setup`.
///
/// La rifilatura di una pagina è il rettangolo da tagliare, a scala 1 la
/// misura del suo albero; con l'abbondanza l'albero è più grande, e la
/// rifilatura è la misura della pagina senza ([`Page::frame`]). Il disegno va
/// sulla carta con la scala della pagina di stampa, e gli effetti che
/// `svg2pdf` dipinge restano a 300 punti per pollice sulla carta.
pub(super) fn write_pdf(
    drawing: &mut Drawing<'_>,
    file: &File<'_>,
    setup: &Setup,
    out: &mut dyn ArtifactSink,
    report: &mut ExportReport,
) -> Result<Outcome, PluginError> {
    let failed = |error: String| {
        Ok(Outcome::Failed(format!(
            "the drawing could not be converted to PDF: {error}"
        )))
    };
    // Una pagina alla volta: l'albero di una tavola se ne va appena il suo
    // pezzo di PDF è scritto.
    let mut pages = Vec::with_capacity(file.pages.len());
    for page in &file.pages {
        let tree = match drawing.tree(&page.text) {
            Ok(tree) => tree,
            Err(reason) => return Ok(Outcome::Failed(reason)),
        };
        let size = tree.size();
        let drawn = [f64::from(size.width()), f64::from(size.height())];
        let (trim, bleed) = match page.frame {
            Some(frame) => (frame, setup.bleed),
            None => {
                drawing.unbled |= setup.bleed > 0.0;
                (drawn, 0.0)
            }
        };
        let setup = Setup { bleed, ..*setup };
        let sheet = print::layout(trim[0], trim[1], &setup);
        let units_per_inch = CSS_DPI / sheet.scale as f32;
        let mut options = pdf::options(&tree, units_per_inch);
        // Il testo di un carattere che non si lascia incorporare va a
        // tracciati, con quello di tutta la pagina.
        let outlined = typefaces::restricted(&tree);
        if !outlined.is_empty() {
            options.embed_text = false;
            drawing.typefaces.outlined(outlined);
        }
        let (chunk, root) = match svg2pdf::to_chunk(&tree, options) {
            Ok(converted) => converted,
            Err(error) => return failed(error.to_string()),
        };
        let placed = (!setup.is_plain()).then(|| pdf::Print::new(sheet, drawn, trim, setup.marks));
        match pdf::Page::read(
            chunk.as_bytes(),
            root.get(),
            size.width(),
            size.height(),
            placed,
            page.board.clone(),
        ) {
            Ok(read) => pages.push(read),
            Err(error) => return failed(error),
        }
    }
    let document = match pdf::document(pages, &drawing.title) {
        Ok(document) => document,
        Err(error) => return failed(error),
    };
    let handle = out.open_artifact(&file.path, "application/pdf")?;
    for piece in document.chunks(CHUNK) {
        out.write_artifact(handle, piece)?;
    }
    report.artifacts.push(out.close_artifact(handle)?);
    Ok(Outcome::Done)
}
