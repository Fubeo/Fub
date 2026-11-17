//! Come il banco legge ciò che esce: il PNG pixel per pixel, il PDF per
//! struttura, e il confronto con le baseline.

use super::*;

// ---------------------------------------------------------------------------
// PNG: lettura e confronto
// ---------------------------------------------------------------------------

/// Un PNG decodificato: misura, pixel RGBA e i metadati che l'export scrive.
pub(super) struct Image {
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) rgba: Vec<u8>,
    pub(super) per_meter: Option<u32>,
    pub(super) texts: Vec<(String, String)>,
}

pub(super) fn decode(bytes: &[u8]) -> Image {
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

pub(super) fn same_png(expected: &[u8], actual: &[u8]) -> Result<(), String> {
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
pub(super) fn red_pixels(image: &Image) -> usize {
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
pub(super) enum Token {
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
pub(super) fn tokens(src: &[u8]) -> Vec<Token> {
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

pub(super) fn same_pdf(expected: &[u8], actual: &[u8]) -> Result<(), String> {
    same_tokens(&tokens(expected), &tokens(actual), 0)
}

pub(super) fn is_word(token: &Token, word: &str) -> bool {
    matches!(token, Token::Word(found) if found == word.as_bytes())
}

/// I token di `source`, che sono numeri e parole: un percorso, un operatore.
pub(super) fn operators(source: &str) -> Vec<Token> {
    tokens(source.as_bytes())
}

/// I token dell'oggetto `number` del PDF `pdf`, da dopo `number 0 obj` a prima
/// di `endobj`: il dizionario, e il flusso se c'è.
pub(super) fn object(pdf: &[Token], number: usize) -> &[Token] {
    let start = pdf
        .windows(3)
        .position(|w| {
            matches!(&w[0], Token::Number(n) if *n == number as f64)
                && w[1] == Token::Number(0.0)
                && is_word(&w[2], "obj")
        })
        .unwrap_or_else(|| panic!("nessun oggetto {number}"))
        + 3;
    let end = pdf[start..]
        .iter()
        .position(|t| is_word(t, "endobj"))
        .expect("la fine dell'oggetto")
        + start;
    &pdf[start..end]
}

/// L'oggetto a cui `tokens` dà il nome `name` (`/gs1`, `/xo0`, `/G`) con un
/// riferimento: `name 12 0 R`.
pub(super) fn reference(tokens: &[Token], name: &str) -> usize {
    tokens
        .windows(4)
        .find_map(|w| match (&w[0], &w[1], &w[2], &w[3]) {
            (t, Token::Number(n), Token::Number(_), r) if is_word(t, name) && is_word(r, "R") => {
                Some(*n as usize)
            }
            _ => None,
        })
        .unwrap_or_else(|| panic!("nessun riferimento {name}"))
}

/// Il flusso di contenuto, già decompresso e letto per token, di `object`.
pub(super) fn content_of(object: &[Token]) -> Vec<Token> {
    object
        .iter()
        .find_map(|t| match t {
            Token::Stream(data) => Some(tokens(data)),
            _ => None,
        })
        .expect("un flusso")
}

/// I `q` che il flusso `content` ha aperto e non ancora chiuso prima del token `at`.
pub(super) fn saved_before(content: &[Token], at: usize) -> Vec<usize> {
    let mut open = Vec::new();
    for (i, token) in content[..at].iter().enumerate() {
        if is_word(token, "q") {
            open.push(i);
        } else if is_word(token, "Q") {
            open.pop();
        }
    }
    open
}

/// Gli stati grafici (`/gs1 gs`) in vigore al token `at`: quelli impostati in
/// un `q` ancora aperto.
pub(super) fn states_at(content: &[Token], at: usize) -> Vec<String> {
    let mut frames: Vec<Vec<String>> = vec![Vec::new()];
    for (i, token) in content[..at].iter().enumerate() {
        if is_word(token, "q") {
            frames.push(Vec::new());
        } else if is_word(token, "Q") {
            frames.pop();
        } else if let (true, Some(Token::Word(name))) = (
            is_word(token, "gs"),
            i.checked_sub(1).and_then(|before| content.get(before)),
        ) {
            frames
                .last_mut()
                .expect("un livello")
                .push(String::from_utf8_lossy(name).into_owned());
        }
    }
    frames.concat()
}

// ---------------------------------------------------------------------------
// Le baseline
// ---------------------------------------------------------------------------

pub(super) fn baseline(name: &str, actual: &[u8], same: fn(&[u8], &[u8]) -> Result<(), String>) {
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
