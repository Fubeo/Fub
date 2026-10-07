//! L'export dei disegni (`fub.draw`): che cosa esce, e che cosa non si tocca.
//!
//! Cinque domande, e un gruppo di prove per ciascuna.
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
//! - **Le opzioni.** Le tavole escono un file ciascuna, o una pagina ciascuna
//!   con il suo segnalibro nel PDF; la selezione esce nel suo riquadro; senza
//!   la carta il PNG è trasparente e il JPEG bianco; un'opzione sbagliata ferma
//!   l'export prima di aprire un file. L'SVG pulito si disegna come il
//!   derivato, a meno dei numeri arrotondati, e ripulirlo non lo cambia.

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
use fub_features::{
    JpegExport, PdfExport, PngExport, SvgExport, DRAW_JPEG, DRAW_PDF, DRAW_PNG, DRAW_SVG,
};
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

fn jpeg_of(host: &MemoryHost, doc: &str, options: serde_json::Value) -> Vec<u8> {
    let report = export(&JpegExport, host, DRAW_JPEG, &[doc], options).unwrap();
    only_artifact(&report).1
}

fn svg_of(host: &MemoryHost, doc: &str, options: serde_json::Value) -> String {
    let report = export(&SvgExport, host, DRAW_SVG, &[doc], options).unwrap();
    String::from_utf8(only_artifact(&report).1).expect("UTF-8")
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

    // In SVG il numero resta del nome del disegno, prima della parola.
    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["disegni/mare.svg", "disegni/Mare.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let paths: Vec<&str> = report.artifacts.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            "disegni/Mare (exported).svg",
            "disegni/mare 1 (exported).svg"
        ]
    );

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
    let jpeg = jpeg_of(&host, "disegno.svg", serde_json::Value::Null);
    // L'SVG ripete i riferimenti, che sono il testo del disegno, ma non li
    // segue.
    svg_of(&host, "disegno.svg", serde_json::Value::Null);

    // Niente rete: nessuna connessione aspetta nel backlog del server.
    match hostile.listener.accept() {
        Err(error) if error.kind() == ErrorKind::WouldBlock => {}
        other => panic!("the export reached the network: {other:?}"),
    }
    assert!(host.network_requests().is_empty());
    // Niente vault oltre al disegno: le due immagini rosse non sono state
    // lette, e le sole letture sono quelle del disegno, una per formato.
    assert_eq!(host.reads_on("rosso.png"), (0, 0));
    assert_eq!(host.reads_on("Allegati/rosso.svg"), (0, 0));
    let drawing = hostile.svg.len();
    assert_eq!(host.reads_on("disegno.svg"), (4, 4 * drawing));
    assert_eq!(host.read_totals(), (4, 4 * drawing));

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
    assert!(
        jpeg == jpeg_of(&twin, "disegno.svg", serde_json::Value::Null),
        "the JPEG differs from its twin"
    );
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
                (&JpegExport, DRAW_JPEG),
                (&SvgExport, DRAW_SVG),
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

// ---------------------------------------------------------------------------
// Le opzioni: che cosa, con che sfondo, a che misura
// ---------------------------------------------------------------------------

/// Il quaderno con quattro tavole di `fub-format-svg`: «Copertina», «Mappa
/// del porto», una senza titolo che si chiama col suo id, e un'altra
/// «Copertina».
fn quaderno() -> String {
    let path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../fub-format-svg/tests/fixtures/boards.svg");
    fs::read_to_string(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

/// Gli artefatti di un export, per path, con i loro byte.
fn artifacts(report: &ExportReport) -> Vec<(String, Vec<u8>)> {
    report
        .artifacts
        .iter()
        .map(|a| (a.path.clone(), a.as_bytes().expect("in memoria").to_vec()))
        .collect()
}

fn paths(report: &ExportReport) -> Vec<&str> {
    report.artifacts.iter().map(|a| a.path.as_str()).collect()
}

/// Il JPEG decodificato: misura e pixel RGB.
fn decode_jpeg(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
    let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
        .expect("un JPEG valido")
        .to_rgb8();
    (image.width(), image.height(), image.into_raw())
}

/// I segmenti di un JPEG fino ai dati dell'immagine: marcatore e contenuto.
fn jpeg_segments(bytes: &[u8]) -> Vec<(u8, Vec<u8>)> {
    assert!(bytes.starts_with(&[0xFF, 0xD8]), "SOI");
    let mut segments = Vec::new();
    let mut at = 2;
    loop {
        assert_eq!(bytes[at], 0xFF, "a marker at {at}");
        let marker = bytes[at + 1];
        let length = usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
        segments.push((marker, bytes[at + 4..at + 2 + length].to_vec()));
        if marker == 0xDA {
            return segments;
        }
        at += 2 + length;
    }
}

/// Un sink che ricorda ciò che si apre: un errore delle opzioni arriva prima
/// di ogni file.
#[derive(Default)]
struct Watched {
    inner: MemorySink,
    opened: Vec<String>,
}

impl fub_abi::transfer::ArtifactSink for Watched {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<fub_abi::transfer::ArtifactHandle, PluginError> {
        self.opened.push(path.to_string());
        self.inner.open_artifact(path, media_type)
    }

    fn write_artifact(
        &mut self,
        handle: fub_abi::transfer::ArtifactHandle,
        bytes: &[u8],
    ) -> Result<(), PluginError> {
        self.inner.write_artifact(handle, bytes)
    }

    fn close_artifact(
        &mut self,
        handle: fub_abi::transfer::ArtifactHandle,
    ) -> Result<fub_abi::transfer::ExportArtifact, PluginError> {
        self.inner.close_artifact(handle)
    }
}

/// La chiave e gli argomenti dell'errore di un export.
fn refusal(outcome: Result<ExportReport, PluginError>) -> (String, Vec<String>) {
    let Err(PluginError::BadArgs(text)) = outcome else {
        panic!("{outcome:?}");
    };
    let message = text.as_message().expect("un messaggio del catalogo");
    (
        message.key.clone(),
        message
            .args
            .iter()
            .map(|arg| arg.value.to_string())
            .collect(),
    )
}

#[test]
fn boards_come_out_one_file_each_in_the_order_of_the_drawing() {
    let host = host().with_document("Scienze/quaderno.svg", &quaderno());
    // L'ordine della richiesta non conta, una ripetizione nemmeno.
    let options = serde_json::json!({
        "scope": "boards",
        "boards": ["b00000004", "b00000001", "b00000003", "b00000001"],
        "scale": 0.5,
    });
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["Scienze/quaderno.svg"],
        options.clone(),
    )
    .unwrap();
    assert!(report.log.is_empty(), "{:?}", report.log);
    // Il nome della tavola fra parentesi; la seconda «Copertina» prende un
    // numero, e la tavola senza titolo si chiama col suo id.
    assert_eq!(
        paths(&report),
        [
            "Scienze/quaderno (Copertina).png",
            "Scienze/quaderno (b00000003).png",
            "Scienze/quaderno (Copertina 1).png",
        ]
    );
    for (_, bytes) in artifacts(&report) {
        let image = decode(&bytes);
        // 600 × 400 unità a scala 0,5.
        assert_eq!((image.width, image.height), (300, 200));
        assert_eq!(image.per_meter, Some(1890));
    }
    // La prima tavola ha la scritta «Partenza», la terza è solo carta.
    let first = decode(&artifacts(&report)[0].1);
    let dark = |image: &Image| {
        image
            .rgba
            .chunks(4)
            .filter(|px| px[0] < 100 && px[3] == 255)
            .count()
    };
    assert!(dark(&first) > 50);
    assert_eq!(dark(&decode(&artifacts(&report)[1].1)), 0);

    let report = export(
        &JpegExport,
        &host,
        DRAW_JPEG,
        &["Scienze/quaderno.svg"],
        options.clone(),
    )
    .unwrap();
    assert_eq!(
        paths(&report),
        [
            "Scienze/quaderno (Copertina).jpg",
            "Scienze/quaderno (b00000003).jpg",
            "Scienze/quaderno (Copertina 1).jpg",
        ]
    );
    assert!(report
        .artifacts
        .iter()
        .all(|a| a.media_type == "image/jpeg"));

    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["Scienze/quaderno.svg"],
        options,
    )
    .unwrap();
    assert_eq!(
        paths(&report),
        [
            "Scienze/quaderno (Copertina).svg",
            "Scienze/quaderno (b00000003).svg",
            "Scienze/quaderno (Copertina 1).svg",
        ]
    );
    // L'SVG di una tavola è la sua derivazione, ripulita: la tela è la
    // tavola, e dei `view` non resta niente.
    let source = quaderno();
    let scope = fub_scene::export::Scope::Board("b00000003".to_string());
    let derived =
        fub_scene::export::derive(&source, &scope, fub_scene::export::Background::Paper).unwrap();
    let expected = fub_scene::export::clean(&derived, &scope).unwrap();
    assert_eq!(
        String::from_utf8(artifacts(&report)[1].1.clone()).unwrap(),
        expected
    );
    assert!(expected.contains(r#"viewBox="0 500 600 400" width="600" height="400""#));
    assert!(!expected.contains("<view"));
    assert!(report
        .artifacts
        .iter()
        .all(|a| a.media_type == "image/svg+xml"));
}

#[test]
fn the_pdf_of_boards_has_a_page_and_a_bookmark_for_each() {
    let host = host().with_document("Scienze/quaderno.svg", &quaderno());
    let options = serde_json::json!({
        "scope": "boards",
        "boards": ["b00000002", "b00000004", "b00000001"],
    });
    let pdf_of_boards = || {
        let report = export(
            &PdfExport,
            &host,
            DRAW_PDF,
            &["Scienze/quaderno.svg"],
            options.clone(),
        )
        .unwrap();
        assert!(report.log.is_empty(), "{:?}", report.log);
        only_artifact(&report)
    };
    let (path, bytes) = pdf_of_boards();
    // Un file solo, col nome del disegno.
    assert_eq!(path, "Scienze/quaderno.pdf");
    let text = String::from_utf8_lossy(&bytes).into_owned();
    // Tre pagine nell'ordine del documento, 600 × 400 unità ciascuna.
    assert!(
        text.contains("/Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3"),
        "{text}"
    );
    assert_eq!(text.matches("/MediaBox [0 0 450 300]").count(), 3);
    // I segnalibri: la radice, poi uno per pagina, col nome della tavola.
    assert!(
        text.contains("/Outlines 10 0 R /PageMode /UseOutlines"),
        "{text}"
    );
    assert!(text.contains("10 0 obj\n<</Type /Outlines /First 11 0 R /Last 13 0 R /Count 3>>"));
    assert!(text.contains(
        "11 0 obj\n<</Title (Copertina) /Parent 10 0 R /Next 12 0 R /Dest [3 0 R /Fit]>>"
    ));
    assert!(text.contains(
        "12 0 obj\n<</Title (Mappa del porto) /Parent 10 0 R /Prev 11 0 R /Next 13 0 R /Dest [5 0 R /Fit]>>"
    ));
    assert!(text.contains(
        "13 0 obj\n<</Title (Copertina) /Parent 10 0 R /Prev 12 0 R /Dest [7 0 R /Fit]>>"
    ));
    assert!(text.contains("/Info 9 0 R /Root 1 0 R"));
    // Le tre tavole sono lo stesso disegno: il carattere si scrive una volta.
    assert_eq!(text.matches("/FontFile2").count(), 1, "{text}");
    // E lo stesso export dà gli stessi byte, anche con più pagine.
    for _ in 0..4 {
        assert_eq!(pdf_of_boards().1, bytes);
    }

    // Una tavola sola: il suo nome nel file.
    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["Scienze/quaderno.svg"],
        serde_json::json!({"scope": "boards", "boards": ["b00000002"]}),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "Scienze/quaderno (Mappa del porto).pdf");
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("/Count 1"));
    assert!(text.contains("/Title (Mappa del porto) /Parent 6 0 R /Dest [3 0 R /Fit]"));
}

#[test]
fn the_selection_is_cut_to_its_box_and_named_with_the_suffix() {
    let host = host().with_document("disegni/scena.svg", &fixture("scena.svg"));
    // L'ellisse col suo contorno: 50 × 25 di raggio intorno a (80, 60), più 2.
    let selection = serde_json::json!({"ids": ["o1a2b3c4d"], "box": [28, 33, 104, 54]});
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["disegni/scena.svg"],
        serde_json::json!({
            "scope": "selection",
            "selection": selection,
            "suffix": "selezione",
            "scale": 1,
        }),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena (selezione).png");
    let image = decode(&bytes);
    assert_eq!((image.width, image.height), (104, 54));
    let at = |x: u32, y: u32| {
        let i = ((y * image.width + x) * 4) as usize;
        image.rgba[i..i + 4].to_vec()
    };
    // Nel mezzo dell'ellisse, senza riempimento, c'era il cielo: con la
    // selezione resta la carta.
    assert_eq!(at(52, 27), [255, 255, 255, 255]);
    // Il contorno dell'ellisse c'è: il blu a sinistra, sul suo asse.
    let edge = at(2, 27);
    assert!(edge[2] > 150 && edge[0] < 60, "{edge:?}");

    // Senza `suffix`, la parola di serie.
    let report = export(
        &PdfExport,
        &host,
        DRAW_PDF,
        &["disegni/scena.svg"],
        serde_json::json!({"scope": "selection", "selection": selection}),
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    assert_eq!(path, "disegni/scena (selection).pdf");
    let text = String::from_utf8_lossy(&bytes);
    // 104 × 54 unità sono 78 × 40,5 punti; nessun segnalibro.
    assert!(text.contains("/MediaBox [0 0 78 40.5]"), "{text}");
    assert!(!text.contains("/Outlines"));
}

#[test]
fn without_the_paper_the_png_is_transparent_and_the_jpeg_white() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let none = serde_json::json!({"background": "none", "scale": 1});
    let report = export(&PngExport, &host, DRAW_PNG, &["scena.svg"], none.clone()).unwrap();
    let (path, bytes) = only_artifact(&report);
    // Il disegno intero: il nome di sempre.
    assert_eq!(path, "scena.png");
    let image = decode(&bytes);
    let corner = ((245 * image.width + 395) * 4) as usize;
    assert_eq!(image.rgba[corner + 3], 0);
    let with_paper = decode(&png_of(&host, "scena.svg"));
    let corner_2x = ((490 * with_paper.width + 790) * 4) as usize;
    assert_eq!(
        with_paper.rgba[corner_2x..corner_2x + 4],
        [255, 255, 255, 255]
    );

    // Sotto il JPEG resta il bianco.
    let (width, _, rgb) = decode_jpeg(&jpeg_of(&host, "scena.svg", none));
    let corner = ((245 * width + 395) * 3) as usize;
    assert!(
        rgb[corner..corner + 3].iter().all(|&c| c >= 250),
        "{:?}",
        &rgb[corner..corner + 3]
    );

    // E l'SVG non ha più la carta.
    let svg = svg_of(
        &host,
        "scena.svg",
        serde_json::json!({"background": "none"}),
    );
    assert!(!svg.contains("fub-paper"));
    assert!(svg_of(&host, "scena.svg", serde_json::Value::Null).contains(r#"id="fub-paper""#));
}

#[test]
fn a_jpeg_is_the_png_on_white_with_its_density_and_nothing_else() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let bytes = jpeg_of(&host, "scena.svg", serde_json::Value::Null);
    let segments = jpeg_segments(&bytes);
    let markers: Vec<u8> = segments.iter().map(|(marker, _)| *marker).collect();
    // Il JFIF e nient'altro di facoltativo: niente EXIF, profili o commenti.
    assert_eq!(markers[0], 0xE0);
    assert!(
        markers[1..]
            .iter()
            .all(|m| matches!(m, 0xDB | 0xC0 | 0xC4 | 0xDA)),
        "{markers:X?}"
    );
    // La densità in punti per pollice: 96 per la scala 2.
    let jfif = &segments[0].1;
    assert!(jfif.starts_with(b"JFIF\0"));
    assert_eq!(jfif[7], 1, "units: dots per inch");
    assert_eq!(&jfif[8..12], &[0, 192, 0, 192]);
    // Il colore senza sottocampionare: ogni componente 1 × 1.
    let frame = &segments.iter().find(|(m, _)| *m == 0xC0).unwrap().1;
    assert_eq!(frame[5], 3);
    for component in frame[6..].chunks(3) {
        assert_eq!(component[1], 0x11, "{frame:?}");
    }

    // I pixel sono quelli del PNG posato sul bianco, a meno del JPEG.
    let png = decode(&png_of(&host, "scena.svg"));
    let (width, height, rgb) = decode_jpeg(&bytes);
    assert_eq!((width, height), (png.width, png.height));
    let mut total = 0u64;
    for (px, jp) in png.rgba.chunks(4).zip(rgb.chunks(3)) {
        let alpha = u32::from(px[3]);
        for channel in 0..3 {
            let on_white = (u32::from(px[channel]) * alpha + 255 * (255 - alpha) + 127) / 255;
            total += u64::from((on_white as u8).abs_diff(jp[channel]));
        }
    }
    let mean = total as f64 / f64::from(width * height * 3);
    assert!(mean < 1.5, "mean difference {mean}");

    // Lo stesso disegno, gli stessi byte.
    assert_eq!(jpeg_of(&host, "scena.svg", serde_json::Value::Null), bytes);
}

#[test]
fn a_width_gives_exactly_those_pixels() {
    let host = host().with_document("scena.svg", &fixture("scena.svg"));
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["scena.svg"],
        serde_json::json!({"width": 1000}),
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    // 400 × 250 unità a 1000 pixel di larghezza: scala 2,5.
    assert_eq!((image.width, image.height), (1000, 625));
    assert_eq!(image.per_meter, Some(9449));
    let bytes = jpeg_of(&host, "scena.svg", serde_json::json!({"width": 1000}));
    assert_eq!(decode_jpeg(&bytes).0, 1000);
    assert_eq!(&jpeg_segments(&bytes)[0].1[8..12], &[0, 240, 0, 240]);

    // Una larghezza che farebbe l'immagine troppo alta esce ridotta, e il
    // log lo dice.
    let tall = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="4000"><rect width="100" height="4000" fill="#0072b2"/></svg>"##;
    let host = host.with_document("torre.svg", tall);
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["torre.svg"],
        serde_json::json!({"width": 1000}),
    )
    .unwrap();
    let image = decode(&only_artifact(&report).1);
    assert_eq!((image.width, image.height), (410, 16_384));
    assert_eq!(
        messages(&report),
        ["exported 410 pixels wide instead of 1000: at the requested width the image would exceed 16384 pixels per side or 32 million pixels"]
    );
}

#[test]
fn a_wrong_option_stops_the_export_before_any_file() {
    let host = host()
        .with_document("Scienze/quaderno.svg", &quaderno())
        .with_document("scena.svg", &fixture("scena.svg"));
    let selection = |ids: serde_json::Value| {
        let selection = serde_json::json!({"ids": ids, "box": [0, 0, 10, 10]});
        serde_json::json!({"scope": "selection", "selection": selection})
    };
    // Il provider, la sua destinazione, i documenti, le opzioni e l'errore.
    type Case<'a> = (
        &'a dyn ExportProvider,
        &'a str,
        Vec<&'a str>,
        serde_json::Value,
        &'a str,
    );
    let cases: Vec<Case> = vec![
        (
            &PngExport,
            DRAW_PNG,
            vec!["scena.svg"],
            serde_json::json!({"scope": "pages"}),
            "e_scope",
        ),
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg"],
            serde_json::json!({"scope": "boards"}),
            "e_boards",
        ),
        (
            &SvgExport,
            DRAW_SVG,
            vec!["scena.svg"],
            serde_json::json!({"scope": "selection"}),
            "e_selection",
        ),
        (
            &JpegExport,
            DRAW_JPEG,
            vec!["scena.svg"],
            serde_json::json!({"background": "white"}),
            "e_background",
        ),
        (
            &JpegExport,
            DRAW_JPEG,
            vec!["scena.svg"],
            serde_json::json!({"scale": 2, "width": 800}),
            "e_scale_and_width",
        ),
        (
            &PngExport,
            DRAW_PNG,
            vec!["scena.svg"],
            serde_json::json!({"width": 0}),
            "e_width",
        ),
        (
            &PngExport,
            DRAW_PNG,
            vec!["scena.svg"],
            serde_json::json!({"scope": "selection", "selection": {"ids": ["o1a2b3c4d"], "box": [0, 0, 0, 10]}}),
            "e_box",
        ),
        // Con le tavole e la selezione, un disegno solo.
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg", "Scienze/quaderno.svg"],
            serde_json::json!({"scope": "boards", "boards": ["b00000001"]}),
            "e_one_drawing",
        ),
        // Ciò che il disegno non ha: anche dopo una tavola che c'è.
        (
            &PngExport,
            DRAW_PNG,
            vec!["Scienze/quaderno.svg"],
            serde_json::json!({"scope": "boards", "boards": ["b00000001", "b9"]}),
            "e_board",
        ),
        // Un id che non è un oggetto: la carta, un `tspan`, una risorsa.
        (
            &SvgExport,
            DRAW_SVG,
            vec!["scena.svg"],
            selection(serde_json::json!(["o1a2b3c4d", "fub-paper"])),
            "e_object",
        ),
        (
            &PdfExport,
            DRAW_PDF,
            vec!["scena.svg"],
            selection(serde_json::json!(["cielo"])),
            "e_object",
        ),
    ];
    for (provider, target, docs, options, key) in cases {
        let request = ExportRequest::new(
            target,
            ExportSelection::Documents(docs.iter().map(|doc| DocId::new(*doc)).collect()),
        )
        .with_options(options.clone());
        let mut sink = Watched::default();
        let outcome = provider.export(&request, &host, &mut sink);
        let (got, args) = refusal(outcome);
        assert_eq!(got, key, "{options}");
        assert!(sink.opened.is_empty(), "{options}: {:?}", sink.opened);
        match key {
            "e_board" => assert_eq!(args, ["Scienze/quaderno.svg", "b9"]),
            "e_object" => assert_eq!(args[0], "scena.svg"),
            "e_one_drawing" => assert_eq!(args, ["2"]),
            _ => {}
        }
    }
}

#[test]
fn the_new_formats_give_the_same_bytes_every_time() {
    let host = host()
        .with_document("scena.svg", &fixture("scena.svg"))
        .with_document("Scienze/quaderno.svg", &quaderno());
    let svg = svg_of(&host, "scena.svg", serde_json::Value::Null);
    assert_eq!(svg_of(&host, "scena.svg", serde_json::Value::Null), svg);
    // L'SVG pulito di un disegno pulito non cambia.
    assert_eq!(
        fub_scene::export::clean(&svg, &fub_scene::export::Scope::Drawing).unwrap(),
        svg
    );
    let boards = serde_json::json!({"scope": "boards", "boards": ["b00000001", "b00000002"], "background": "none"});
    for (provider, target) in [
        (&PngExport as &dyn ExportProvider, DRAW_PNG),
        (&JpegExport, DRAW_JPEG),
        (&SvgExport, DRAW_SVG),
        (&PdfExport, DRAW_PDF),
    ] {
        let once = export(
            provider,
            &host,
            target,
            &["Scienze/quaderno.svg"],
            boards.clone(),
        )
        .unwrap();
        let again = export(
            provider,
            &host,
            target,
            &["Scienze/quaderno.svg"],
            boards.clone(),
        )
        .unwrap();
        assert_eq!(artifacts(&once), artifacts(&again), "{target}");
    }
}

#[test]
fn the_svg_carries_the_vault_images_it_can_read() {
    use base64::Engine as _;
    let svg = with_images(&[
        ("foto/rosso.png", 0, 60),
        ("foto/manca.png", 60, 40),
        ("https://example.org/a.png", 100, 30),
        ("foto/rosso.png", 130, 30),
    ]);
    let red = red_png();
    let host = host()
        .with_document("disegni/acqua.svg", &svg)
        .with_binary_document("disegni/foto/rosso.png", &red);
    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["disegni/acqua.svg"],
        serde_json::Value::Null,
    )
    .unwrap();
    let (path, bytes) = only_artifact(&report);
    // Il disegno è già `acqua.svg`: l'export ha la parola fra parentesi.
    assert_eq!(path, "disegni/acqua (exported).svg");
    let text = String::from_utf8(bytes).expect("UTF-8");
    // Fuori dal vault un percorso non porta a niente: l'immagine entra coi
    // suoi byte, letti una volta anche se il disegno la usa due volte.
    let uri = format!(
        "href=\"data:image/png;base64,{}\"",
        base64::engine::general_purpose::STANDARD.encode(&red)
    );
    assert_eq!(text.matches(&uri).count(), 2, "{text}");
    assert_eq!(host.reads_on("disegni/foto/rosso.png"), (1, red.len()));
    // Ciò che non c'è resta com'è, e il log lo dice; un indirizzo del web
    // resta un indirizzo.
    assert!(text.contains("href=\"foto/manca.png\""), "{text}");
    assert!(
        text.contains("href=\"https://example.org/a.png\""),
        "{text}"
    );
    assert_eq!(
        messages(&report),
        ["1 image is not in the vault and was not exported: foto/manca.png"]
    );
    assert_eq!(report.log[0].entry.as_deref(), Some("disegni/acqua.svg"));

    // La parola la sceglie chi esporta, nella sua lingua.
    let report = export(
        &SvgExport,
        &host,
        DRAW_SVG,
        &["disegni/acqua.svg"],
        serde_json::json!({"suffix": "esportato"}),
    )
    .unwrap();
    assert_eq!(only_artifact(&report).0, "disegni/acqua (esportato).svg");
}

/// I pixel moltiplicati per la loro opacità, e l'opacità: ciò che si vede.
/// Il colore di un pixel quasi trasparente, diviso per un'opacità di 1 su 255,
/// può cambiare di tutto senza che si veda niente.
fn premultiplied(image: &Image) -> Vec<u8> {
    image
        .rgba
        .chunks(4)
        .flat_map(|px| {
            let alpha = u16::from(px[3]);
            let times = |c: u8| ((u16::from(c) * alpha + 127) / 255) as u8;
            [times(px[0]), times(px[1]), times(px[2]), px[3]]
        })
        .collect()
}

/// Il PNG a scala 1 di un testo SVG, come disegno di un vault da solo.
fn png_of_text(text: &str) -> Option<Image> {
    let host = host().with_document("prova.svg", text);
    let report = export(
        &PngExport,
        &host,
        DRAW_PNG,
        &["prova.svg"],
        serde_json::json!({"scale": 1}),
    )
    .ok()?;
    Some(decode(&only_artifact(&report).1))
}

/// Quanto possono differire il disegno derivato e quello pulito, che scrive i
/// numeri con 2 decimali: un punto si sposta al più di mezzo centesimo, e la
/// copertura di un pixel di bordo cambia di un livello o due. Dove il punto è
/// la punta di uno spigolo vivo o dà la direzione a un marker lo spostamento si
/// amplifica, e qualche pixel cambia di più: mai più di un quarto, mai più di
/// un valore su mille, e in media meno di un centesimo di livello.
const CLEAN_TOLERANCE: u8 = 4;
const CLEAN_WORST: u8 = 64;

#[test]
fn the_clean_svg_draws_the_pixels_of_the_derived_one() {
    let scene_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fub-scene/tests/corpus");
    let vectors = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/__fixtures__/scene-export");
    let read_json = |name: &str| -> Vec<serde_json::Value> {
        let text = fs::read_to_string(vectors.join(name)).unwrap();
        serde_json::from_str(&text).unwrap()
    };
    let scope_of = |vector: &serde_json::Value| -> fub_scene::export::Scope {
        let scope = &vector["scope"];
        match scope["kind"].as_str().unwrap() {
            "drawing" => fub_scene::export::Scope::Drawing,
            "board" => fub_scene::export::Scope::Board(scope["id"].as_str().unwrap().to_string()),
            "selection" => fub_scene::export::Scope::Selection {
                ids: scope["ids"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|id| id.as_str().unwrap().to_string())
                    .collect(),
                rect: <[f64; 4]>::try_from(
                    scope["box"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|n| n.as_f64().unwrap())
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
            },
            other => panic!("{other}"),
        }
    };
    // Il corpus di `fub-scene` derivato intero; i testi derivati dei casi
    // della derivazione; i testi di partenza di quelli dell'SVG pulito.
    let mut cases: Vec<(String, String, fub_scene::export::Scope)> = Vec::new();
    let mut corpus: Vec<PathBuf> = fs::read_dir(&scene_dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "svg"))
        .collect();
    corpus.sort();
    for path in corpus {
        let scope = fub_scene::export::Scope::Drawing;
        let source = fs::read_to_string(&path).unwrap();
        let derived =
            fub_scene::export::derive(&source, &scope, fub_scene::export::Background::Paper)
                .unwrap();
        cases.push((path.display().to_string(), derived, scope));
    }
    for vector in read_json("derive.json") {
        if let Some(text) = vector["expect"]["text"].as_str() {
            cases.push((
                format!("derive: {}", vector["name"]),
                text.to_string(),
                scope_of(&vector),
            ));
        }
    }
    for vector in read_json("clean.json") {
        if vector["expect"]["text"].is_string() {
            let input = vector["input"].as_str().unwrap().to_string();
            cases.push((
                format!("clean: {}", vector["name"]),
                input,
                scope_of(&vector),
            ));
        }
    }
    let mut drawn = 0;
    for (name, derived, scope) in cases {
        let cleaned =
            fub_scene::export::clean(&derived, &scope).unwrap_or_else(|e| panic!("{name}: {e}"));
        // Ripulire non cambia niente.
        assert_eq!(
            fub_scene::export::clean(&cleaned, &scope).unwrap(),
            cleaned,
            "{name}"
        );
        // Un disegno che non si disegna, come una tela vuota, non si
        // disegna nemmeno pulito.
        let (before, after) = match (png_of_text(&derived), png_of_text(&cleaned)) {
            (Some(before), Some(after)) => (before, after),
            (None, None) => continue,
            _ => panic!("{name}: one draws and the other does not"),
        };
        drawn += 1;
        assert_eq!(
            (before.width, before.height),
            (after.width, after.height),
            "{name}"
        );
        let (pa, pb) = (premultiplied(&before), premultiplied(&after));
        let mut worst = 0u8;
        let mut beyond = 0usize;
        let mut total = 0u64;
        for (a, b) in pa.iter().zip(&pb) {
            let d = a.abs_diff(*b);
            worst = worst.max(d);
            beyond += usize::from(d > CLEAN_TOLERANCE);
            total += u64::from(d);
        }
        let mean = total as f64 / pa.len() as f64;
        assert!(
            worst <= CLEAN_WORST && beyond * 1000 <= pa.len() && mean < 0.01,
            "{name}: worst {worst}, {beyond} values beyond {CLEAN_TOLERANCE}, mean {mean}"
        );
    }
    assert!(drawn >= 40, "{drawn}");
}
