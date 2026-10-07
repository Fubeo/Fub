//! L'export dei disegni (`fub.draw`): che cosa esce, e che cosa non si tocca.
//!
//! Quattro domande, e un gruppo di prove per ciascuna.
//!
//! - **Che cosa esce.** Il PNG e il PDF di una scena si confrontano con le
//!   baseline in `tests/baselines/draw/`. Si rigenerano soltanto con
//!   `FUB_UPDATE_BASELINES=1`, mai da sole: una baseline che si riscrive quando
//!   il test fallisce non prova niente. Il PNG si confronta pixel per pixel con
//!   una tolleranza di 2 livelli su 255 per canale: `tiny-skia` calcola alcuni
//!   reciproci con istruzioni approssimate (`rcpps` su x86, `vrecpe` su ARM)
//!   che non danno lo stesso bit su processori diversi, e la suite di `resvg`
//!   stessa ammette 1 livello. Il PDF si confronta per struttura: gli stessi
//!   oggetti con gli stessi valori, i numeri a meno di un millesimo, i flussi
//!   decompressi; la tabella dei riferimenti incrociati e le lunghezze non
//!   contano, perché dipendono dal numero di cifre di un numero.
//! - **Le immagini del vault.** Entrano risolte dal disegno e lette una volta,
//!   finché ci stanno nel tetto; quelle che restano fuori, il log le nomina.
//! - **Che cosa non si tocca.** Un disegno ostile nomina la rete (un server in
//!   ascolto su `127.0.0.1`), file locali per `file:` e per path assoluto, un
//!   file oltre la radice del vault, un SVG del vault, un `@import`, un `<use>`
//!   esterno, un `feImage`, un SVG incorporato e un carattere di sistema.
//!   Nessuna di quelle risorse si apre, e l'export è uguale a quello del suo
//!   gemello pulito. Dove il sistema ha le FIFO, i file locali lo sono:
//!   aprirne una in lettura si blocca, quindi un export che finisce non ne ha
//!   aperta nessuna.
//! - **Lo stesso disegno, gli stessi byte.** Due export dello stesso disegno
//!   sono identici, anche con più caratteri nello stesso PDF.

#![cfg(feature = "draw")]

use std::fs;
use std::io::ErrorKind;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

use fub_abi::format::{DocumentFormat, FormatCapabilities, FormatDescriptor};
use fub_abi::model::{Block, DocId, DocumentModel, Inline, Span};
use fub_abi::transfer::{
    ExportProvider, ExportReport, ExportRequest, ExportSelection, MemorySink, NoteLevel,
};
use fub_abi::PluginError;
use fub_features::{PdfExport, PngExport, DRAW_PDF, DRAW_PNG};
use fub_sdk::testing::MemoryHost;

// ---------------------------------------------------------------------------
// Il banco
// ---------------------------------------------------------------------------

/// Il formato dei disegni come lo dichiara `fub-format-svg`: qui conta solo
/// l'id, che è ciò che l'export guarda.
fn drawing_format() -> DocumentFormat {
    DocumentFormat {
        descriptor: FormatDescriptor::text("svg", "Drawing", &["svg"]),
        capabilities: FormatCapabilities::default(),
    }
}

fn host() -> MemoryHost {
    MemoryHost::new().with_format("svg", drawing_format())
}

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/draw")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn export(
    provider: &dyn ExportProvider,
    host: &MemoryHost,
    target: &str,
    docs: &[&str],
    options: serde_json::Value,
) -> Result<ExportReport, PluginError> {
    let request = ExportRequest::new(
        target,
        ExportSelection::Documents(docs.iter().map(|doc| DocId::new(*doc)).collect()),
    )
    .with_options(options);
    provider.export(&request, host, &mut MemorySink::default())
}

/// L'unico artefatto di un export di un disegno solo.
fn only_artifact(report: &ExportReport) -> (String, Vec<u8>) {
    assert_eq!(report.artifacts.len(), 1, "{:?}", report.log);
    let artifact = &report.artifacts[0];
    let bytes = artifact.as_bytes().expect("in memoria").to_vec();
    (artifact.path.clone(), bytes)
}

fn png_of(host: &MemoryHost, doc: &str) -> Vec<u8> {
    let report = export(&PngExport, host, DRAW_PNG, &[doc], serde_json::Value::Null).unwrap();
    only_artifact(&report).1
}

fn pdf_of(host: &MemoryHost, doc: &str) -> Vec<u8> {
    let report = export(&PdfExport, host, DRAW_PDF, &[doc], serde_json::Value::Null).unwrap();
    only_artifact(&report).1
}

fn messages(report: &ExportReport) -> Vec<String> {
    report.log.iter().map(|note| note.message.clone()).collect()
}

// ---------------------------------------------------------------------------
// PNG: lettura e confronto
// ---------------------------------------------------------------------------

/// Un PNG decodificato: misura, pixel RGBA e i metadati che l'export scrive.
struct Image {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    per_meter: Option<u32>,
    texts: Vec<(String, String)>,
}

fn decode(bytes: &[u8]) -> Image {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().expect("un PNG valido");
    let mut rgba = vec![0; reader.output_buffer_size().expect("misura")];
    let frame = reader.next_frame(&mut rgba).expect("i pixel");
    assert_eq!(frame.color_type, png::ColorType::Rgba);
    assert_eq!(frame.bit_depth, png::BitDepth::Eight);
    rgba.truncate(frame.buffer_size());
    let info = reader.info();
    Image {
        width: info.width,
        height: info.height,
        rgba,
        per_meter: info.pixel_dims.map(|dims| {
            assert_eq!(dims.xppu, dims.yppu);
            dims.xppu
        }),
        texts: info
            .utf8_text
            .iter()
            .map(|chunk| (chunk.keyword.clone(), chunk.get_text().unwrap()))
            .collect(),
    }
}

/// Lo scarto massimo per canale fra due PNG della stessa misura.
const PNG_TOLERANCE: u8 = 2;

fn same_png(expected: &[u8], actual: &[u8]) -> Result<(), String> {
    let (expected, actual) = (decode(expected), decode(actual));
    if (expected.width, expected.height) != (actual.width, actual.height) {
        return Err(format!(
            "size {}×{} instead of {}×{}",
            actual.width, actual.height, expected.width, expected.height
        ));
    }
    if expected.per_meter != actual.per_meter || expected.texts != actual.texts {
        return Err("different metadata (pHYs or iTXt)".to_string());
    }
    let mut worst = 0u8;
    let mut off = 0usize;
    for (a, b) in expected.rgba.iter().zip(&actual.rgba) {
        let delta = a.abs_diff(*b);
        worst = worst.max(delta);
        if delta > PNG_TOLERANCE {
            off += 1;
        }
    }
    match off {
        0 => Ok(()),
        _ => Err(format!(
            "{off} channels differ by more than {PNG_TOLERANCE} (worst {worst})"
        )),
    }
}

/// Quanti pixel sono rossi: è il colore di ogni risorsa ostile.
fn red_pixels(image: &Image) -> usize {
    image
        .rgba
        .chunks(4)
        .filter(|px| px[0] > 180 && px[1] < 90 && px[2] < 90 && px[3] > 0)
        .count()
}

// ---------------------------------------------------------------------------
// PDF: lettura per struttura
// ---------------------------------------------------------------------------

/// Un pezzo di un PDF, quanto basta per confrontarne due.
#[derive(Debug, PartialEq)]
enum Token {
    Number(f64),
    Word(Vec<u8>),
    Stream(Vec<u8>),
}

fn is_white(b: u8) -> bool {
    matches!(b, b'\0' | b'\t' | b'\n' | b'\x0C' | b'\r' | b' ')
}

fn is_delimiter(b: u8) -> bool {
    matches!(
        b,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

/// I token di un PDF o di un flusso di contenuto. Un flusso diventa un token
/// solo, decompresso se è `FlateDecode`; la tabella dei riferimenti incrociati,
/// l'offset dopo `startxref` e i valori di `/Length` restano fuori.
fn tokens(src: &[u8]) -> Vec<Token> {
    let mut out = Vec::new();
    let mut at = 0;
    let mut length: Option<usize> = None;
    let mut deflated = false;
    let mut skip_number = false;
    while at < src.len() {
        let b = src[at];
        if is_white(b) {
            at += 1;
            continue;
        }
        if b == b'%' {
            while at < src.len() && src[at] != b'\n' && src[at] != b'\r' {
                at += 1;
            }
            continue;
        }
        let start = at;
        let word: &[u8] = match b {
            b'<' | b'>' if src.get(at + 1) == Some(&b) => {
                at += 2;
                &src[start..at]
            }
            b'[' | b']' | b'{' | b'}' => {
                at += 1;
                &src[start..at]
            }
            b'<' => {
                while at < src.len() && src[at] != b'>' {
                    at += 1;
                }
                at += 1;
                &src[start..at.min(src.len())]
            }
            b'(' => {
                let mut open = 0;
                while at < src.len() {
                    match src[at] {
                        b'\\' => at += 1,
                        b'(' => open += 1,
                        b')' => {
                            open -= 1;
                            if open == 0 {
                                at += 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                    at += 1;
                }
                &src[start..at.min(src.len())]
            }
            b'/' => {
                at += 1;
                while at < src.len() && !is_white(src[at]) && !is_delimiter(src[at]) {
                    at += 1;
                }
                &src[start..at]
            }
            _ => {
                while at < src.len() && !is_white(src[at]) && !is_delimiter(src[at]) {
                    at += 1;
                }
                if at == start {
                    at += 1;
                }
                &src[start..at]
            }
        };
        match word {
            b"xref" => {
                // Fino al trailer: offset, non contenuto.
                let rest = &src[at..];
                let trailer = rest
                    .windows(7)
                    .position(|w| w == b"trailer")
                    .expect("un trailer");
                at += trailer;
                continue;
            }
            b"startxref" => {
                skip_number = true;
                continue;
            }
            b"/Length" => {
                // Il valore si legge per saltare il flusso, non si confronta.
                let digits: String = src[at..]
                    .iter()
                    .skip_while(|b| is_white(**b))
                    .take_while(|b| b.is_ascii_digit())
                    .map(|b| char::from(*b))
                    .collect();
                length = digits.parse().ok();
                skip_number = true;
                continue;
            }
            b"/FlateDecode" => deflated = true,
            b"stream" => {
                if src[at] == b'\r' {
                    at += 1;
                }
                at += 1;
                let n = length.take().expect("un flusso con la sua lunghezza");
                let data = &src[at..at + n];
                at += n;
                let data = if std::mem::take(&mut deflated) {
                    let mut plain = Vec::new();
                    std::io::Read::read_to_end(
                        &mut flate2::read::ZlibDecoder::new(data),
                        &mut plain,
                    )
                    .expect("un flusso FlateDecode valido");
                    plain
                } else {
                    data.to_vec()
                };
                out.push(Token::Stream(data));
                continue;
            }
            b"endobj" => deflated = false,
            _ => {}
        }
        let text = std::str::from_utf8(word).ok();
        match text.and_then(|text| text.parse::<f64>().ok()) {
            Some(_) if std::mem::take(&mut skip_number) => {}
            Some(number) if !word.starts_with(b"/") => out.push(Token::Number(number)),
            _ => out.push(Token::Word(word.to_vec())),
        }
    }
    out
}

fn same_tokens(expected: &[Token], actual: &[Token], depth: usize) -> Result<(), String> {
    if expected.len() != actual.len() {
        return Err(format!(
            "{} tokens instead of {}",
            actual.len(),
            expected.len()
        ));
    }
    for (i, (a, b)) in expected.iter().zip(actual).enumerate() {
        let same = match (a, b) {
            (Token::Number(a), Token::Number(b)) => (a - b).abs() <= 1e-3,
            (Token::Stream(a), Token::Stream(b)) if a == b => true,
            // Un flusso di contenuto si confronta per token, con la stessa
            // tolleranza sui numeri; un flusso binario (un carattere,
            // un'immagine) no, e lì basta un byte per essere diversi.
            (Token::Stream(a), Token::Stream(b)) if depth == 0 => {
                let (a, b) = (tokens(a), tokens(b));
                same_tokens(&a, &b, 1).is_ok()
            }
            (a, b) => a == b,
        };
        if !same {
            return Err(format!("token {i} differs: {a:?} vs {b:?}"));
        }
    }
    Ok(())
}

fn same_pdf(expected: &[u8], actual: &[u8]) -> Result<(), String> {
    same_tokens(&tokens(expected), &tokens(actual), 0)
}

// ---------------------------------------------------------------------------
// Le baseline
// ---------------------------------------------------------------------------

fn baseline(name: &str, actual: &[u8], same: fn(&[u8], &[u8]) -> Result<(), String>) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/baselines/draw")
        .join(name);
    if std::env::var_os("FUB_UPDATE_BASELINES").is_some_and(|value| value == "1") {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, actual).unwrap();
        return;
    }
    let expected = fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "{} is missing: regenerate it with FUB_UPDATE_BASELINES=1",
            path.display()
        )
    });
    if let Err(difference) = same(&expected, actual) {
        let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(name);
        fs::write(&out, actual).unwrap();
        panic!(
            "{name} differs from its baseline: {difference}. The new export is in {}; \
             if the change is intended, regenerate with FUB_UPDATE_BASELINES=1",
            out.display()
        );
    }
}

// ---------------------------------------------------------------------------
// Che cosa esce
// ---------------------------------------------------------------------------

#[test]
fn the_png_of_a_scene_matches_its_baseline() {
    let host = host().with_document("disegni/scena.svg", &fixture("scena.svg"));
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegni/scena.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena.png");
    assert_eq!(report.artifacts[0].media_type, "image/png");
    assert!(report.log.is_empty(), "{:?}", report.log);

    let image = decode(&bytes);
    // Scala 2 di serie: 400 × 250 pixel CSS diventano 800 × 500.
    assert_eq!((image.width, image.height), (800, 500));
    // 192 punti per pollice, in punti per metro.
    assert_eq!(image.per_meter, Some(7559));
    baseline("scena.png", &bytes, same_png);
}

#[test]
fn the_pdf_of_a_scene_matches_its_baseline() {
    let host = host().with_document("disegni/scena.svg", &fixture("scena.svg"));
    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["disegni/scena.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena.pdf");
    assert_eq!(report.artifacts[0].media_type, "application/pdf");
    assert!(report.log.is_empty(), "{:?}", report.log);

    let text = String::from_utf8_lossy(&bytes);
    assert!(text.starts_with("%PDF-1.7\n"));
    assert!(text.ends_with("%%EOF\n"));
    // 400 × 250 pixel CSS a 96 per pollice sono 300 × 187,5 punti.
    assert!(text.contains("/MediaBox [0 0 300 187.5]"), "{text}");
    // Il testo resta testo, nei caratteri di Fub incorporati.
    for font in [
        "Inter-Regular",
        "Inter-Bold",
        "Literata-Bold",
        "JetBrainsMono-Regular",
    ] {
        assert!(text.contains(&format!("+{font}")), "{font} is not embedded");
    }
    assert!(text.contains("/FontFile2"));
    baseline("scena.pdf", &bytes, same_pdf);
}

#[test]
fn the_same_drawing_gives_the_same_bytes() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let png = png_of(&host, "scena.svg");
    assert_eq!(png, png_of(&host, "scena.svg"));
    // `svg2pdf` scrive caratteri e risorse nell'ordine di una `HashMap`, che
    // cambia a ogni istanza: con quattro caratteri nello stesso disegno, otto
    // export uguali vogliono dire che l'ordine non viene da lì.
    let pdf = pdf_of(&host, "scena.svg");
    for _ in 0..8 {
        assert_eq!(pdf, pdf_of(&host, "scena.svg"));
    }
}

#[test]
fn the_title_of_the_drawing_reaches_both_files() {
    let mut model = DocumentModel::empty(DocId::new("acqua.svg"));
    model.body.push(Block::Custom {
        custom_kind: "svg.scene".to_string(),
        attrs: serde_json::Value::Null,
        blocks: vec![Block::Heading {
            level: 1,
            inlines: vec![Inline::Text("Città d'acqua".to_string())],
            anchor: None,
            span: Span::new(0, 1),
            explicit_anchor: None,
        }],
        anchor: None,
        span: Span::new(0, 1),
    });
    let host = host()
        .with_document("acqua.svg", &fixture("scena.svg"))
        .with_model("acqua.svg", model)
        .with_document("senza.svg", &fixture("scena.svg"));

    let image = decode(&png_of(&host, "acqua.svg"));
    assert!(image
        .texts
        .contains(&("Title".to_string(), "Città d'acqua".to_string())));
    let pdf = String::from_utf8_lossy(&pdf_of(&host, "acqua.svg")).into_owned();
    // Non ASCII, quindi UTF-16BE con il BOM.
    let utf16: String = "\u{feff}Città d'acqua"
        .encode_utf16()
        .map(|unit| format!("{unit:04X}"))
        .collect();
    assert!(pdf.contains(&format!("/Title <{utf16}>")), "{pdf}");
    assert!(pdf.contains("/DisplayDocTitle true"));

    // Senza modello, il nome del file.
    let image = decode(&png_of(&host, "senza.svg"));
    assert!(image
        .texts
        .contains(&("Title".to_string(), "senza".to_string())));
    let pdf = String::from_utf8_lossy(&pdf_of(&host, "senza.svg")).into_owned();
    assert!(pdf.contains("/Title (senza)"));
}

#[test]
fn the_scale_sets_pixels_and_density() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["scena.svg"],
        serde_json::json!({ "scale": 0.5 }),
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    assert_eq!((image.width, image.height), (200, 125));
    assert_eq!(image.per_meter, Some(1890));

    for wrong in [
        serde_json::json!(0),
        serde_json::json!(-1),
        serde_json::json!(8.5),
        serde_json::json!("2"),
        serde_json::json!([2]),
    ] {
        let outcome = export(
            &PngExport,
            &host,
            DRAW_PNG,
            &["scena.svg"],
            serde_json::json!({ "scale": wrong }),
        );
        assert!(
            matches!(outcome, Err(PluginError::BadArgs(_))),
            "scale {wrong} accepted"
        );
    }
}

#[test]
fn a_drawing_too_large_for_a_png_comes_out_smaller_and_says_so() {
    let wide = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="10"><rect width="40000" height="10" fill="#0072b2"/></svg>"##;
    let host = host().with_document("striscia.svg", wide);
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["striscia.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    assert!(image.width <= 16_384, "{}", image.width);
    assert!(image.width > 16_000, "{}", image.width);
    let log = messages(&report);
    assert!(log.iter().any(|m| m.contains("instead of 2")), "{log:?}");
}

#[test]
fn a_huge_drawing_keeps_its_size_on_a_pdf_page() {
    // 40 000 pixel CSS sono 30 000 punti, oltre il lato massimo di una pagina
    // per i lettori (14 400): la pagina dichiara un'unità più grande.
    let wide = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="10"><rect width="40000" height="10" fill="#0072b2"/></svg>"##;
    let host = host().with_document("striscia.svg", wide);
    let pdf = String::from_utf8_lossy(&pdf_of(&host, "striscia.svg")).into_owned();
    let after = |key: &str| -> Vec<f64> {
        let rest = &pdf[pdf.find(key).unwrap_or_else(|| panic!("{key}: {pdf}")) + key.len()..];
        let end = rest.find([']', '>', '/']).unwrap();
        rest[..end]
            .split_whitespace()
            .map(|n| n.trim_start_matches('[').parse().unwrap())
            .collect()
    };
    let unit = after("/UserUnit ")[0];
    let media = after("/MediaBox ");
    assert_eq!(unit, 2.0834);
    assert!(media[2] <= 14_400.0, "{media:?}");
    // Moltiplicata per l'unità, la pagina è il disegno: 30 000 × 7,5 punti.
    assert!((media[2] * unit - 30_000.0).abs() < 0.01, "{media:?}");
    assert!((media[3] * unit - 7.5).abs() < 0.001, "{media:?}");
}

#[test]
fn a_webp_image_reaches_both_formats() {
    // Un WebP senza perdita, 2 × 2 pixel verdi: `svg2pdf` di suo non decodifica
    // WebP, e la feature `webp` di `image` è accesa per questo.
    let mut webp = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
        .encode(
            &[0, 158, 115].repeat(4),
            2,
            2,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image width="20" height="20" image-rendering="optimizeSpeed" href="data:image/webp;base64,{}"/></svg>"##,
        base64(&webp)
    );
    let host = host().with_document("verde.svg", &svg);

    let image = decode(&png_of(&host, "verde.svg"));
    let green = image
        .rgba
        .chunks(4)
        .filter(|px| px == &[0, 158, 115, 255])
        .count();
    assert_eq!(green, (image.width * image.height) as usize);

    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["verde.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let pdf = only_artifact(&report).1;
    let pdf = String::from_utf8_lossy(&pdf);
    assert!(pdf.contains("/Subtype /Image"), "{pdf}");
}

#[test]
fn characters_outside_fubs_fonts_are_noted() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="10" y="30" font-family="Inter, sans-serif" font-size="20">Acqua 水 Ω</text></svg>"##;
    let host = host().with_document("lingue.svg", svg);
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&PdfExport, DRAW_PDF),
    ] {
        let report = export(
            provider,
            &host,
            target,
            &["lingue.svg"],
            serde_json::Value::Null,
        )
        .unwrap();
        assert_eq!(report.artifacts.len(), 1);
        let note = report
            .log
            .iter()
            .find(|note| note.message.contains("outside Fub's fonts"))
            .unwrap_or_else(|| panic!("{:?}", report.log));
        assert_eq!(note.level, NoteLevel::Warning);
        assert_eq!(note.entry.as_deref(), Some("lingue.svg"));
        assert!(note.message.ends_with("Ω水"), "{}", note.message);
    }
}

// ---------------------------------------------------------------------------
// Le immagini del vault
// ---------------------------------------------------------------------------

/// Un disegno di 160 × 100 con le immagini `images`, ognuna `(href, x,
/// larghezza)` a tutta altezza, i pixel senza sfumature.
fn with_images(images: &[(&str, u32, u32)]) -> String {
    let images: String = images
        .iter()
        .map(|(href, x, width)| {
            format!(
                r#"<image x="{x}" y="0" width="{width}" height="100" preserveAspectRatio="none" image-rendering="optimizeSpeed" href="{href}"/>"#
            )
        })
        .collect();
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100" width="160" height="100">{images}</svg>"#
    )
}

#[test]
fn vault_images_reach_both_formats() {
    // Un percorso relativo al disegno, come lo scrive `format_link`, e uno
    // dalla radice del vault.
    let svg = with_images(&[("foto/rosso.png", 0, 80), ("/Allegati/rosso.png", 80, 80)]);
    let host = host()
        .with_document("disegni/acqua.svg", &svg)
        .with_binary_document("disegni/foto/rosso.png", &red_png())
        .with_binary_document("Allegati/rosso.png", &red_png());

    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegni/acqua.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let image = decode(&only_artifact(&report).1);
    assert_eq!(red_pixels(&image), (image.width * image.height) as usize);

    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["disegni/acqua.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    let pdf = only_artifact(&report).1;
    assert!(String::from_utf8_lossy(&pdf).contains("/Subtype /Image"));
}

#[test]
fn a_vault_image_is_read_once_per_drawing() {
    // Quattro modi di scrivere lo stesso file: due percorsi uguali dopo la
    // pulizia dell'URL, due diversi che portano allo stesso file.
    let svg = with_images(&[
        ("rosso.png", 0, 40),
        (" rosso.png ", 40, 40),
        ("./rosso.png", 80, 40),
        ("/rosso.png", 120, 40),
    ]);
    let red = red_png();
    let host = host()
        .with_document("disegno.svg", &svg)
        .with_binary_document("rosso.png", &red);

    let image = decode(&png_of(&host, "disegno.svg"));
    assert_eq!(red_pixels(&image), (image.width * image.height) as usize);
    assert_eq!(host.reads_on("rosso.png"), (1, red.len()));
}

#[test]
fn vault_images_stop_at_the_budget_and_the_rest_still_come_in() {
    // Il tetto è di 64 MiB per disegno, in ordine di testo: la prima immagine
    // ne consuma un poco, e la seconda, che da sola ci starebbe, non ci sta più.
    // Non si legge nemmeno, e la terza entra lo stesso.
    let red = red_png();
    let mut large = b"\x89PNG\r\n\x1a\n".to_vec();
    large.resize(64 * 1024 * 1024 - red.len() + 1, 0);
    let svg = with_images(&[
        ("prima.png", 0, 40),
        ("grande.png", 40, 80),
        ("terza.png", 120, 40),
    ]);
    let host = host()
        .with_document("disegno.svg", &svg)
        .with_binary_document("prima.png", &red)
        .with_binary_document("grande.png", &large)
        .with_binary_document("terza.png", &red);

    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegno.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert_eq!(
        messages(&report),
        ["1 vault image did not fit in the 64 MiB of images of a drawing and was not exported: grande.png"]
    );
    assert_eq!(host.reads_on("grande.png"), (0, 0));
    assert_eq!(host.reads_on("terza.png"), (1, red.len()));
    // Le due immagini che ci stanno, metà del disegno, e in mezzo lo sfondo
    // trasparente.
    let image = decode(&only_artifact(&report).1);
    assert_eq!(
        red_pixels(&image),
        (image.width * image.height / 2) as usize
    );
}

// ---------------------------------------------------------------------------
// La selezione, i nomi, gli errori
// ---------------------------------------------------------------------------

#[test]
fn only_drawings_are_exported_and_names_never_collide() {
    let svg = fixture("scena.svg");
    let host = host()
        .with_document("disegni/mare.svg", &svg)
        .with_document("disegni/Mare.svg", &svg)
        .with_document("note/Pioggia.md", "# Pioggia\n");
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["note/Pioggia.md", "disegni/mare.svg", "disegni/Mare.svg"],
        serde_json::json!({ "scale": 0.25 }),
    )
    .unwrap();
    let paths: Vec<&str> = report.artifacts.iter().map(|a| a.path.as_str()).collect();
    // L'ordine è quello della selezione risolta, cioè dei path.
    assert_eq!(paths, ["disegni/Mare.png", "disegni/mare 1.png"]);
    assert_eq!(
        messages(&report),
        ["1 selected document is not a drawing and was skipped"]
    );
    assert_eq!(report.log[0].level, NoteLevel::Info);

    let outcome = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["note/Pioggia.md"],
        serde_json::Value::Null,
    );
    assert!(matches!(outcome, Err(PluginError::BadArgs(_))));
}

#[test]
fn a_target_that_is_not_its_own_is_refused() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PDF),
        (&PdfExport, DRAW_PNG),
        (&PdfExport, "importers.pdf"),
    ] {
        let outcome = export(
            provider,
            &host,
            target,
            &["scena.svg"],
            serde_json::Value::Null,
        );
        assert!(matches!(outcome, Err(PluginError::BadArgs(_))), "{target}");
    }
}

#[test]
fn a_broken_drawing_does_not_stop_the_others() {
    let host = host()
        .with_document(
            "rotto.svg",
            "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect",
        )
        .with_document("scena.svg", &fixture("scena.svg"));
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&PdfExport, DRAW_PDF),
    ] {
        let report = export(
            provider,
            &host,
            target,
            &["rotto.svg", "scena.svg"],
            serde_json::Value::Null,
        )
        .unwrap();
        assert_eq!(report.artifacts.len(), 1);
        assert_eq!(report.log.len(), 1, "{:?}", report.log);
        assert_eq!(report.log[0].level, NoteLevel::Warning);
        assert_eq!(report.log[0].entry.as_deref(), Some("rotto.svg"));
        assert!(report.log[0]
            .message
            .starts_with("not a readable SVG drawing"));

        // Da solo, niente da consegnare: un errore che dice perché.
        let outcome = export(
            provider,
            &host,
            target,
            &["rotto.svg"],
            serde_json::Value::Null,
        );
        let Err(PluginError::BadArgs(text)) = outcome else {
            panic!("{outcome:?}");
        };
        let shown = format!("{text:?}");
        assert!(shown.contains("rotto.svg"), "{shown}");
        assert!(shown.contains("not a readable SVG drawing"), "{shown}");
    }
}

// ---------------------------------------------------------------------------
// Che cosa non si tocca
// ---------------------------------------------------------------------------

/// Un PNG rosso 4 × 4: il colore di ogni risorsa che non deve comparire.
fn red_png() -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, 4, 4);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().unwrap();
    writer.write_image_data(&[255, 0, 0].repeat(16)).unwrap();
    writer.finish().unwrap();
    bytes
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[(n >> (18 - 6 * i)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Una scena con `extra` dentro: il gemello pulito e quello ostile differiscono
/// solo lì.
fn scene(extra: &str) -> String {
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 160 100" width="160" height="100">
  <rect x="0" y="0" width="160" height="100" fill="#ffffff"/>
  <rect x="10" y="10" width="40" height="30" fill="#0072b2"/>
  {extra}
</svg>
"##
    )
}

/// Tutto ciò che un disegno ostile può nominare, puntato verso risorse rosse.
struct Hostile {
    listener: TcpListener,
    _dir: tempfile::TempDir,
    svg: String,
    clean: String,
}

fn hostile() -> Hostile {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let net = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());

    let dir = tempfile::tempdir().unwrap();
    let red = dir.path().join("rosso.png");
    fs::write(&red, red_png()).unwrap();
    let other = dir.path().join("altro.svg");
    fs::write(
        &other,
        r##"<svg xmlns="http://www.w3.org/2000/svg"><rect id="forma" width="160" height="100" fill="#ff0000"/></svg>"##,
    )
    .unwrap();
    let css = dir.path().join("stile.css");
    fs::write(&css, "rect { fill: #ff0000 !important; }").unwrap();
    let file = |path: &Path| {
        let path = path.to_string_lossy().replace('\\', "/");
        let path = path.trim_start_matches('/');
        format!("file:///{path}")
    };
    let absolute = red.to_string_lossy().into_owned();
    let red_svg = base64(
        br##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>"##,
    );

    let hostile = format!(
        r##"<style>
    @import url("{net}/stile.css");
    @import url("{css}");
    @font-face {{ font-family: "Remoto"; src: url("{net}/carattere.ttf"); }}
  </style>
  <image x="60" y="10" width="20" height="20" href="{net}/rosso.png"/>
  <image x="60" y="10" width="20" height="20" xlink:href="{net}/rosso.png"/>
  <image x="80" y="10" width="20" height="20" href="{red_file}"/>
  <image x="80" y="10" width="20" height="20" href="{absolute}"/>
  <image x="100" y="10" width="20" height="20" href="../rosso.png"/>
  <image x="100" y="10" width="20" height="20" href="Allegati/rosso.svg"/>
  <image x="120" y="10" width="20" height="20" href="data:image/svg+xml;base64,{red_svg}"/>
  <filter id="remoto"><feImage href="{net}/filtro.png"/></filter>
  <rect x="0" y="50" width="160" height="50" fill="#ff0000" filter="url(#remoto)"/>
  <use href="{net}/altro.svg#forma"/>
  <use xlink:href="{other_file}#forma"/>
  <foreignObject x="0" y="0" width="160" height="100"><img xmlns="http://www.w3.org/1999/xhtml" src="{net}/rosso.png"/></foreignObject>
  <text x="10" y="80" font-family="DejaVu Sans" font-size="16" fill="#000000">Pioggia</text>"##,
        css = file(&css),
        red_file = file(&red),
        other_file = file(&other),
    );
    // Il gemello: lo stesso testo nel carattere che il ripiego deve scegliere
    // (Literata, la famiglia con grazie, come per un `font-family` che il
    // database non conosce). Se il disegno ostile arrivasse a DejaVu Sans di
    // sistema, il testo cambierebbe forma e i due PNG non coinciderebbero.
    // Il filtro resta, senza sorgente: un `feImage` che non si carica e uno
    // che non nomina niente danno la stessa immagine trasparente.
    let clean = r##"<filter id="remoto"><feImage/></filter>
  <rect x="0" y="50" width="160" height="50" fill="#ff0000" filter="url(#remoto)"/>
  <text x="10" y="80" font-family="serif" font-size="16" fill="#000000">Pioggia</text>"##;
    Hostile {
        listener,
        _dir: dir,
        svg: scene(&hostile),
        clean: scene(clean),
    }
}

#[test]
fn a_hostile_drawing_opens_nothing_and_exports_like_its_clean_twin() {
    let hostile = hostile();
    // Lo stesso nome nei due vault: il titolo dei file viene da lì, e così i
    // due export si possono confrontare byte per byte.
    // Rossi anche nel vault: il PNG dove un `..` di troppo porterebbe se la
    // radice non fosse un confine, e un SVG, che non è un raster.
    let host = host()
        .with_document("disegno.svg", &hostile.svg)
        .with_binary_document("rosso.png", &red_png())
        .with_document(
            "Allegati/rosso.svg",
            r##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>"##,
        );
    let twin = self::host().with_document("disegno.svg", &hostile.clean);

    let png = png_of(&host, "disegno.svg");
    let pdf = pdf_of(&host, "disegno.svg");

    // Niente rete: nessuna connessione aspetta nel backlog del server.
    match hostile.listener.accept() {
        Err(error) if error.kind() == ErrorKind::WouldBlock => {}
        other => panic!("the export reached the network: {other:?}"),
    }
    assert!(host.network_requests().is_empty());
    // Niente vault oltre al disegno: le due immagini rosse non sono state
    // lette, e le sole letture sono le due del disegno, una per formato.
    assert_eq!(host.reads_on("rosso.png"), (0, 0));
    assert_eq!(host.reads_on("Allegati/rosso.svg"), (0, 0));
    let drawing = hostile.svg.len();
    assert_eq!(host.reads_on("disegno.svg"), (2, 2 * drawing));
    assert_eq!(host.read_totals(), (2, 2 * drawing));

    // Niente file locali, niente SVG incorporati, niente carattere di sistema:
    // non c'è un pixel rosso, e i due file sono quelli del gemello pulito.
    assert_eq!(red_pixels(&decode(&png)), 0);
    assert!(
        png == png_of(&twin, "disegno.svg"),
        "the PNG differs from its twin"
    );
    let clean = pdf_of(&twin, "disegno.svg");
    if pdf != clean {
        let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
        fs::write(out.join("ostile.pdf"), &pdf).unwrap();
        fs::write(out.join("pulito.pdf"), &clean).unwrap();
        panic!(
            "the PDF differs from its twin: both are in {}",
            out.display()
        );
    }
    // E due export dello stesso disegno ostile sono identici.
    assert!(png == png_of(&host, "disegno.svg"));
    assert!(pdf == pdf_of(&host, "disegno.svg"));
}

#[test]
fn the_log_names_what_was_left_out() {
    let broken_png = base64(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
    let red_svg = base64(
        br##"<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></svg>"##,
    );
    let svg = with_images(&[
        ("https://example.org/a.png", 0, 10),
        ("file:///etc/b.png", 0, 10),
        ("//example.org/c.png", 0, 10),
        ("#d", 0, 10),
        ("mancante.png", 0, 10),
        ("../fuori.png", 0, 10),
        ("nota.md", 0, 10),
        ("rotta.png", 0, 10),
        (&format!("data:image/png;base64,{broken_png}"), 0, 10),
        (&format!("data:image/svg+xml;base64,{red_svg}"), 0, 10),
    ]);
    let host = host()
        .with_document("ostile.svg", &svg)
        .with_document("nota.md", "# Nota\n")
        .with_binary_document("rotta.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["ostile.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    assert_eq!(
        messages(&report),
        [
            "4 image references point outside the vault and were not exported: #d, //example.org/c.png, file:///etc/b.png and 1 more",
            "2 images are not in the vault and were not exported: ../fuori.png, mancante.png",
            "2 vault images are not readable PNG, JPEG, GIF or WebP images and were not exported: nota.md, rotta.png",
            "2 embedded images are not readable PNG, JPEG, GIF or WebP images and were not exported",
        ]
    );
    assert!(report
        .log
        .iter()
        .all(|note| note.entry.as_deref() == Some("ostile.svg")));
    // Una nota non è un'immagine: non si legge nemmeno.
    assert_eq!(host.reads_on("nota.md"), (0, 0));
}

/// La prova più stretta, dove il sistema la permette: le risorse locali sono
/// FIFO, e aprire una FIFO in lettura si blocca finché qualcuno non ci scrive.
/// Un export che ne aprisse una non finirebbe; uno che finisce non ne ha
/// aperta nessuna, nemmeno per scartarne i byte.
#[cfg(unix)]
#[test]
fn a_hostile_drawing_does_not_even_open_local_files() {
    let dir = tempfile::tempdir().unwrap();
    let fifo = |name: &str| {
        let path = dir.path().join(name);
        let made = std::process::Command::new("mkfifo")
            .arg(&path)
            .status()
            .expect("mkfifo");
        assert!(made.success());
        path.to_string_lossy().into_owned()
    };
    let (png, svg, css, font, entity) = (
        fifo("rosso.png"),
        fifo("altro.svg"),
        fifo("stile.css"),
        fifo("carattere.ttf"),
        fifo("entita.txt"),
    );
    let references = scene(&format!(
        r##"<style>
    @import url("file://{css}");
    @import url("{css}");
    @font-face {{ font-family: "Locale"; src: url("file://{font}"); }}
  </style>
  <image width="20" height="20" href="file://{png}"/>
  <image width="20" height="20" href="{png}"/>
  <use href="file://{svg}#forma"/>
  <use xlink:href="{svg}#forma"/>
  <filter id="locale"><feImage href="file://{png}"/></filter>
  <rect width="10" height="10" filter="url(#locale)"/>
  <text x="10" y="80" font-family="Locale" font-size="16">Pioggia</text>"##
    ));
    let entities = format!(
        r##"<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY segreto SYSTEM "file://{entity}">]>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="10" y="30">&segreto;</text></svg>"##
    );
    let host = host()
        .with_document("riferimenti.svg", &references)
        .with_document("entita.svg", &entities);

    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for doc in ["riferimenti.svg", "entita.svg"] {
            for (provider, target) in [
                (&PngExport as &dyn ExportProvider, DRAW_PNG),
                (&PdfExport, DRAW_PDF),
            ] {
                let _ = export(provider, &host, target, &[doc], serde_json::Value::Null);
            }
        }
        done.send(()).unwrap();
    });
    // Se un export si blocca, il suo filo resta lì: il test fallisce lo
    // stesso, e il processo dei test lo chiude uscendo.
    finished
        .recv_timeout(std::time::Duration::from_secs(60))
        .expect("the export opened a local file and is waiting on it");
}

#[test]
fn an_external_entity_is_not_read() {
    let dir = tempfile::tempdir().unwrap();
    let secret = dir.path().join("segreto.txt");
    fs::write(&secret, "SEGRETO").unwrap();
    let svg = format!(
        r##"<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY segreto SYSTEM "file://{}">]>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="10" y="30" font-size="20">&segreto;</text></svg>"##,
        secret.to_string_lossy().replace('\\', "/")
    );
    let host = host().with_document("entita.svg", &svg);
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&PdfExport, DRAW_PDF),
    ] {
        match export(
            provider,
            &host,
            target,
            &["entita.svg"],
            serde_json::Value::Null,
        ) {
            // Se il parser rifiuta l'entità, il disegno non si esporta.
            Err(PluginError::BadArgs(_)) => {}
            // Se la ignora, il testo non c'è: nessun glifo, quindi nessun
            // carattere incorporato nel PDF e nessun pixel scuro nel PNG.
            Ok(report) => {
                let bytes = only_artifact(&report).1;
                if target == DRAW_PDF {
                    assert!(!String::from_utf8_lossy(&bytes).contains("/FontFile2"));
                } else {
                    let image = decode(&bytes);
                    assert!(image.rgba.chunks(4).all(|px| px[3] == 0));
                }
            }
            Err(other) => panic!("{other:?}"),
        }
    }
}
