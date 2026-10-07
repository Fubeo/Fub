//! I valori degli attributi ammessi da §4: numeri, lunghezze, colori, parole
//! chiave, trasformazioni, punti e `href`.
//!
//! Ogni lettore risponde `None` quando il valore non rientra nella specifica,
//! e un valore fuori specifica rende estraneo l'elemento. La regola che guida
//! i casi limite è una sola: si può essere più severi di un browser, mai più
//! indulgenti. Un elemento giudicato estraneo per troppo zelo resta intatto e
//! il browser lo disegna; uno giudicato modificabile che il browser disegna
//! diversamente verrebbe riscritto su una geometria sbagliata.

use crate::geometry::Matrix;

/// Gli spazi che SVG e CSS tolgono intorno a un valore.
pub(crate) fn is_wsp(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')
}

/// `value` senza gli spazi intorno.
pub(crate) fn trim(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_ascii() && is_wsp(c as u8))
}

/// Legge un numero SVG al byte `i` di `text`: segno facoltativo, cifre con o
/// senza decimali, esponente facoltativo. Restituisce il valore e il byte dopo
/// il numero.
///
/// Come i browser vuole una cifra dopo il punto (`1.` non è un numero) e prende
/// l'esponente solo se è seguito da cifre, così `1em` resta un numero con
/// un'unità. Un valore che non sta in un `float` a 32 bit non è un numero: i
/// browser lo rifiutano.
pub(crate) fn scan_number(text: &str, mut i: usize) -> Option<(f64, usize)> {
    let bytes = text.as_bytes();
    let start = i;
    if matches!(bytes.get(i), Some(b'+' | b'-')) {
        i += 1;
    }
    let digits = |i: &mut usize| {
        let from = *i;
        while bytes.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i > from
    };
    let integer = digits(&mut i);
    if bytes.get(i) == Some(&b'.') {
        let mut j = i + 1;
        if !digits(&mut j) {
            return None;
        }
        i = j;
    } else if !integer {
        return None;
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        let mut j = i + 1;
        if matches!(bytes.get(j), Some(b'+' | b'-')) {
            j += 1;
        }
        if digits(&mut j) {
            i = j;
        }
    }
    let value: f64 = text[start..i].parse().ok()?;
    (value.abs() <= f64::from(f32::MAX)).then_some((value, i))
}

/// Un numero SVG da solo, con gli spazi intorno.
pub(crate) fn number(value: &str) -> Option<f64> {
    let value = trim(value);
    match scan_number(value, 0)? {
        (n, end) if end == value.len() => Some(n),
        _ => None,
    }
}

/// Una lunghezza in unità utente: un numero SVG con un'unità assoluta
/// facoltativa, convertita con i rapporti CSS (1in = 96px = 2,54cm = 72pt =
/// 6pc; 1Q = 0,25mm). Percentuali, unità relative e parole chiave non sono
/// lunghezze di §4.
pub(crate) fn length(value: &str) -> Option<f64> {
    let value = trim(value);
    let (n, end) = scan_number(value, 0)?;
    let scale = match &value[end..] {
        "" | "px" => 1.0,
        "in" => 96.0,
        "cm" => 96.0 / 2.54,
        "mm" => 96.0 / 25.4,
        "Q" => 96.0 / 101.6,
        "pt" => 96.0 / 72.0,
        "pc" => 16.0,
        _ => return None,
    };
    Some(n * scale)
}

/// Una lunghezza non negativa.
pub(crate) fn non_negative_length(value: &str) -> Option<f64> {
    length(value).filter(|&n| n >= 0.0)
}

/// Un'opacità: un numero da 0 a 1, senza percentuale.
pub(crate) fn opacity(value: &str) -> Option<f64> {
    number(value).filter(|n| (0.0..=1.0).contains(n))
}

/// Un colore sRGB.
pub(crate) type Rgb = [u8; 3];

/// Il valore di `fill` o `stroke`.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum Paint {
    None,
    Color(Rgb),
}

/// Un colore di §4: `none`, `#rgb`, `#rrggbb` o un nome CSS, nelle forme
/// elencate. `currentColor`, `transparent`, le funzioni e le maiuscole nei
/// nomi non lo sono.
pub(crate) fn paint(value: &str) -> Option<Paint> {
    let value = trim(value);
    if value == "none" {
        return Some(Paint::None);
    }
    if let Some(hex) = value.strip_prefix('#') {
        if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let digit = |i: usize| u8::from_str_radix(&hex[i..=i], 16).ok();
        return match hex.len() {
            3 => Some(Paint::Color([
                digit(0)? * 17,
                digit(1)? * 17,
                digit(2)? * 17,
            ])),
            6 => Some(Paint::Color([
                u8::from_str_radix(&hex[0..2], 16).ok()?,
                u8::from_str_radix(&hex[2..4], 16).ok()?,
                u8::from_str_radix(&hex[4..6], 16).ok()?,
            ])),
            _ => None,
        };
    }
    named_color(value).map(Paint::Color)
}

/// Un nome di colore CSS in minuscolo.
fn named_color(name: &str) -> Option<Rgb> {
    let at = NAMED_COLORS.binary_search_by(|(n, _)| n.cmp(&name)).ok()?;
    let rgb = NAMED_COLORS[at].1;
    Some([(rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8])
}

/// `stroke-dasharray`: `none` oppure lunghezze non negative separate da spazi
/// o virgole.
pub(crate) fn dasharray(value: &str) -> bool {
    let value = trim(value);
    if value == "none" {
        return true;
    }
    let mut items = 0;
    for item in value.split(',') {
        let item = trim(item);
        if item.is_empty() {
            return false;
        }
        for part in item.split(|c: char| c.is_ascii() && is_wsp(c as u8)) {
            if part.is_empty() {
                continue;
            }
            if non_negative_length(part).is_none() {
                return false;
            }
            items += 1;
        }
    }
    items > 0
}

/// Una parola chiave fra quelle elencate per `name`.
pub(crate) fn keyword(name: &str, value: &str) -> bool {
    let value = trim(value);
    let allowed: &[&str] = match name {
        "display" => &["none", "inline"],
        "stroke-linecap" => &["butt", "round", "square"],
        "stroke-linejoin" => &["miter", "round", "bevel"],
        "font-weight" => &[
            "normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900",
        ],
        "font-style" => &["normal", "italic", "oblique"],
        "text-anchor" => &["start", "middle", "end"],
        // Le risorse (§15).
        "spreadMethod" => &["pad", "reflect", "repeat"],
        "gradientUnits" | "patternUnits" | "patternContentUnits" | "clipPathUnits" | "maskUnits"
        | "maskContentUnits" | "filterUnits" => &["userSpaceOnUse", "objectBoundingBox"],
        "markerUnits" => &["strokeWidth", "userSpaceOnUse"],
        "primitiveUnits" => &["userSpaceOnUse"],
        "color-interpolation-filters" => &["auto", "sRGB", "linearRGB"],
        "clip-rule" => &["nonzero", "evenodd"],
        _ => &[],
    };
    allowed.contains(&value)
}

/// `letter-spacing`: `normal`, che vale 0, o una lunghezza, anche negativa.
pub(crate) fn letter_spacing(value: &str) -> Option<f64> {
    if trim(value) == "normal" {
        Some(0.0)
    } else {
        length(value)
    }
}

/// Le linee che `text-decoration` può tirare.
pub(crate) const DECORATIONS: [&str; 3] = ["underline", "overline", "line-through"];

/// `text-decoration`: `none`, che non ne tira, o le linee di [`DECORATIONS`],
/// ognuna al più una volta, separate da spazi.
pub(crate) fn text_decoration(value: &str) -> Option<Vec<&str>> {
    let value = trim(value);
    if value == "none" {
        return Some(Vec::new());
    }
    let parts: Vec<&str> = value
        .split(|c: char| c.is_ascii() && is_wsp(c as u8))
        .filter(|part| !part.is_empty())
        .collect();
    let valid = !parts.is_empty()
        && parts.iter().enumerate().all(|(i, part)| {
            DECORATIONS.contains(part) && parts.iter().position(|p| p == part) == Some(i)
        });
    valid.then_some(parts)
}

/// `preserveAspectRatio`: un allineamento, `none` compreso, seguito
/// facoltativamente da `meet` o `slice`.
pub(crate) fn preserve_aspect_ratio(value: &str) -> bool {
    const ALIGN: [&str; 10] = [
        "none", "xMinYMin", "xMidYMin", "xMaxYMin", "xMinYMid", "xMidYMid", "xMaxYMid", "xMinYMax",
        "xMidYMax", "xMaxYMax",
    ];
    let mut parts = trim(value)
        .split(|c: char| c.is_ascii() && is_wsp(c as u8))
        .filter(|p| !p.is_empty());
    let align = parts.next().is_some_and(|p| ALIGN.contains(&p));
    let meet = parts.next().is_none_or(|p| p == "meet" || p == "slice");
    align && meet && parts.next().is_none()
}

/// Salta un separatore `comma-wsp` facoltativo: restituisce se ha trovato
/// una virgola.
fn skip_separator(bytes: &[u8], i: &mut usize) -> bool {
    while *i < bytes.len() && is_wsp(bytes[*i]) {
        *i += 1;
    }
    let comma = bytes.get(*i) == Some(&b',');
    if comma {
        *i += 1;
        while *i < bytes.len() && is_wsp(bytes[*i]) {
            *i += 1;
        }
    }
    comma
}

/// Una lista di numeri separati da spazi o virgole, senza virgole in testa o
/// in coda. Fra due numeri il separatore può mancare quando il secondo comincia
/// con un segno o un punto (`10-20`, `1.5.5`), come nella grammatica dei path.
pub(crate) fn number_list(value: &str) -> Option<Vec<f64>> {
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() && is_wsp(bytes[i]) {
        i += 1;
    }
    let mut numbers = Vec::new();
    while i < bytes.len() {
        let (n, next) = scan_number(value, i)?;
        numbers.push(n);
        i = next;
        let comma = skip_separator(bytes, &mut i);
        if comma && i == bytes.len() {
            return None;
        }
    }
    Some(numbers)
}

/// `points`: coppie di numeri. Un numero dispari di valori non è una lista di
/// punti.
pub(crate) fn points(value: &str) -> Option<Vec<[f64; 2]>> {
    let numbers = number_list(value)?;
    if numbers.len() % 2 != 0 {
        return None;
    }
    Some(numbers.chunks(2).map(|p| [p[0], p[1]]).collect())
}

/// Una lista di funzioni di trasformazione SVG, composta in una matrice.
///
/// Le funzioni si separano con spazi o con una virgola, e il separatore può
/// mancare (`translate(1)scale(2)`), come nei browser. I nomi sono sensibili
/// alle maiuscole e gli argomenti sono numeri senza unità.
pub(crate) fn transform(value: &str) -> Option<Matrix> {
    let bytes = value.as_bytes();
    let mut i = 0;
    let mut matrix = Matrix::IDENTITY;
    skip_separator_free(bytes, &mut i);
    while i < bytes.len() {
        const NAMES: [&str; 6] = ["matrix", "translate", "scale", "rotate", "skewX", "skewY"];
        let name = NAMES.into_iter().find(|n| value[i..].starts_with(n))?;
        i += name.len();
        skip_separator_free(bytes, &mut i);
        if bytes.get(i) != Some(&b'(') {
            return None;
        }
        i += 1;
        skip_separator_free(bytes, &mut i);
        let mut args = Vec::with_capacity(6);
        while bytes.get(i) != Some(&b')') {
            if args.len() == 6 {
                return None;
            }
            let (n, next) = scan_number(value, i)?;
            args.push(n);
            i = next;
            let comma = skip_separator(bytes, &mut i);
            if comma && bytes.get(i) == Some(&b')') {
                return None;
            }
        }
        i += 1;
        let step = match (name, args.as_slice()) {
            ("matrix", &[a, b, c, d, e, f]) => Matrix([a, b, c, d, e, f]),
            ("translate", &[x]) => Matrix::translate(x, 0.0),
            ("translate", &[x, y]) => Matrix::translate(x, y),
            ("scale", &[s]) => Matrix([s, 0.0, 0.0, s, 0.0, 0.0]),
            ("scale", &[x, y]) => Matrix([x, 0.0, 0.0, y, 0.0, 0.0]),
            ("rotate", &[a]) => Matrix::rotate(a),
            ("rotate", &[a, cx, cy]) => Matrix::translate(cx, cy)
                .then(Matrix::rotate(a))
                .then(Matrix::translate(-cx, -cy)),
            ("skewX", &[a]) => Matrix([1.0, 0.0, a.to_radians().tan(), 1.0, 0.0, 0.0]),
            ("skewY", &[a]) => Matrix([1.0, a.to_radians().tan(), 0.0, 1.0, 0.0, 0.0]),
            _ => return None,
        };
        matrix = matrix.then(step);
        let comma = skip_separator(bytes, &mut i);
        if comma && i == bytes.len() {
            return None;
        }
    }
    Some(matrix)
}

/// Salta gli spazi, senza virgole.
fn skip_separator_free(bytes: &[u8], i: &mut usize) {
    while *i < bytes.len() && is_wsp(bytes[*i]) {
        *i += 1;
    }
}

/// Vero per i byte che chiudono l'id di un `url(#id)`: spazi, virgolette,
/// parentesi e `\`, perché gli escape di CSS non si leggono.
fn id_stop(b: u8) -> bool {
    is_wsp(b) || matches!(b, b'"' | b'\'' | b'(' | b')' | b'\\')
}

/// Salta gli spazi da `i`.
fn skip_wsp(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && is_wsp(bytes[i]) {
        i += 1;
    }
    i
}

/// Legge `url(#id)` al byte `i` di `text`: l'id e il byte dopo la parentesi.
/// `url` in qualunque combinazione di maiuscole ASCII, spazi facoltativi
/// dentro le parentesi, l'id fra virgolette doppie, singole o senza.
fn scan_url(text: &str, i: usize) -> Option<(&str, usize)> {
    let bytes = text.as_bytes();
    if !bytes.get(i..i + 4)?.eq_ignore_ascii_case(b"url(") {
        return None;
    }
    let mut j = skip_wsp(bytes, i + 4);
    let quote = bytes.get(j).copied().filter(|&b| b == b'"' || b == b'\'');
    if quote.is_some() {
        j += 1;
    }
    if bytes.get(j) != Some(&b'#') {
        return None;
    }
    j += 1;
    let from = j;
    while j < bytes.len() && !id_stop(bytes[j]) {
        j += 1;
    }
    if j == from {
        return None;
    }
    let id = &text[from..j];
    if let Some(quote) = quote {
        if bytes.get(j) != Some(&quote) {
            return None;
        }
        j += 1;
    }
    j = skip_wsp(bytes, j);
    (bytes.get(j) == Some(&b')')).then_some((id, j + 1))
}

/// Un riferimento locale da solo, `url(#id)` con gli spazi intorno: l'id.
pub(crate) fn reference(value: &str) -> Option<&str> {
    let text = trim(value);
    scan_url(text, 0)
        .filter(|&(_, end)| end == text.len())
        .map(|(id, _)| id)
}

/// Un `fill` o uno `stroke` che usa una risorsa: l'id e il ripiego, `none` o
/// un colore, se è scritto.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) struct PaintReference<'a> {
    pub id: &'a str,
    pub fallback: Option<Paint>,
}

/// `fill` o `stroke` con una risorsa: `url(#id)`, seguito facoltativamente
/// da spazi e da un ripiego, `none` o un colore di §4.
pub(crate) fn paint_reference(value: &str) -> Option<PaintReference<'_>> {
    let text = trim(value);
    let (id, end) = scan_url(text, 0)?;
    if end == text.len() {
        return Some(PaintReference { id, fallback: None });
    }
    if !is_wsp(text.as_bytes()[end]) {
        return None;
    }
    let fallback = paint(&text[end..])?;
    Some(PaintReference {
        id,
        fallback: Some(fallback),
    })
}

/// Ogni id che `value` nomina con `url(#id)`, in ordine, anche dentro un
/// valore che il formato non legge, come `style` o un foglio CSS.
pub(crate) fn url_ids(value: &str) -> Vec<&str> {
    // `url(` non si sovrappone a sé stesso: provare ogni byte trova ogni
    // riferimento una volta.
    (0..value.len())
        .filter_map(|i| scan_url(value, i).map(|(id, _)| id))
        .collect()
}

/// L'id di un `href` locale, `#id`, letto come lo legge il parser di URL;
/// `None` per ogni altro `href`.
pub(crate) fn href_id(value: &str) -> Option<String> {
    let url = url_text(value);
    (url.len() > 1 && url.starts_with('#')).then(|| url[1..].to_owned())
}

/// Un numero SVG seguito da `%`, come frazione: il numero diviso 100.
pub(crate) fn percentage(value: &str) -> Option<f64> {
    let text = trim(value);
    let body = text.strip_suffix('%')?;
    match scan_number(body, 0)? {
        (n, end) if end == body.len() => Some(n / 100.0),
        _ => None,
    }
}

/// Un numero SVG o una percentuale, come frazione: `offset`, e le coordinate
/// di una risorsa nelle unità del riquadro.
pub(crate) fn fraction(value: &str) -> Option<f64> {
    number(value).or_else(|| percentage(value))
}

/// L'angolo di `orient`, in gradi: un numero SVG seguito facoltativamente
/// da `deg`, `grad` o `rad`.
pub(crate) fn angle(value: &str) -> Option<f64> {
    let text = trim(value);
    let (n, end) = scan_number(text, 0)?;
    match &text[end..] {
        "" | "deg" => Some(n),
        "grad" => Some(n * 0.9),
        "rad" => Some(n * 180.0 / std::f64::consts::PI),
        _ => None,
    }
}

/// Un `viewBox`: quattro numeri SVG separati da spazi o virgole, con
/// larghezza e altezza non negative.
pub(crate) fn view_box(value: &str) -> Option<[f64; 4]> {
    let numbers = number_list(value)?;
    let [x, y, w, h] = <[f64; 4]>::try_from(numbers.as_slice()).ok()?;
    (w >= 0.0 && h >= 0.0).then_some([x, y, w, h])
}

/// Uno o due numeri SVG non negativi: `stdDeviation` e `radius`.
pub(crate) fn one_or_two(value: &str) -> Option<Vec<f64>> {
    let numbers = number_list(value)?;
    ((1..=2).contains(&numbers.len()) && numbers.iter().all(|&n| n >= 0.0)).then_some(numbers)
}

/// Un `href` letto come lo legge il parser di URL: senza spazi e controlli
/// intorno, senza tabulazioni e a capo dentro.
pub(crate) fn url_text(value: &str) -> String {
    value
        .trim_matches(|c: char| c <= ' ')
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect()
}

/// Lo schema di un URL, in minuscolo, se ce n'è uno.
fn scheme(url: &str) -> Option<String> {
    let colon = url.find(':')?;
    let scheme = &url[..colon];
    let mut chars = scheme.chars();
    let valid = chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'));
    valid.then(|| scheme.to_ascii_lowercase())
}

/// Vero se un URL usa lo schema `javascript:`, letto come lo legge il parser
/// di URL: `" java\tscript:"` lo è.
pub(crate) fn is_javascript(value: &str) -> bool {
    scheme(&url_text(value)).as_deref() == Some("javascript")
}

/// Che cosa indica un `href`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Href {
    /// Un percorso del vault: relativo al disegno, o dalla radice del vault se
    /// comincia con `/`. Contiene il testo ripulito come lo legge un URL.
    Vault(String),
    /// Un data URI. `raster` dice se è un'immagine PNG, JPEG, WebP o GIF;
    /// `bytes` è la dimensione dei dati decodificati.
    Data { raster: bool, bytes: usize },
    /// Un URL `http` o `https`.
    Remote,
    /// Tutto il resto: altri schemi, frammenti, `//host`, valore vuoto.
    Other,
}

/// Classifica un `href`.
pub(crate) fn href(value: &str) -> Href {
    let url = url_text(value);
    if url.is_empty() || url.starts_with('#') {
        return Href::Other;
    }
    let mut head = url.chars().take(2);
    let slash = |c: Option<char>| matches!(c, Some('/' | '\\'));
    if slash(head.next()) && slash(head.next()) {
        return Href::Other;
    }
    match scheme(&url).as_deref() {
        None => Href::Vault(url),
        Some("data") => data_uri(&url[5..]),
        Some("http" | "https") => Href::Remote,
        Some(_) => Href::Other,
    }
}

/// Legge un data URI dopo `data:`.
fn data_uri(rest: &str) -> Href {
    let Some((header, payload)) = rest.split_once(',') else {
        return Href::Other;
    };
    let mut params = header.split(';');
    let mime = params.next().unwrap_or("").trim().to_ascii_lowercase();
    let base64 = header
        .rsplit(';')
        .next()
        .is_some_and(|p| p.trim().eq_ignore_ascii_case("base64"))
        && header.contains(';');
    let raster = matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    );
    let bytes = if base64 {
        let symbols = payload
            .bytes()
            .filter(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/'))
            .count();
        symbols * 3 / 4
    } else {
        // Ogni `%XX` vale un byte.
        payload.len() - 2 * payload.matches('%').count().min(payload.len() / 3)
    };
    Href::Data { raster, bytes }
}

/// I colori con nome di CSS Color 4, in ordine alfabetico (`transparent` e
/// `currentcolor` esclusi: §4 li rifiuta).
const NAMED_COLORS: [(&str, u32); 148] = [
    ("aliceblue", 0xf0f8ff),
    ("antiquewhite", 0xfaebd7),
    ("aqua", 0x00ffff),
    ("aquamarine", 0x7fffd4),
    ("azure", 0xf0ffff),
    ("beige", 0xf5f5dc),
    ("bisque", 0xffe4c4),
    ("black", 0x000000),
    ("blanchedalmond", 0xffebcd),
    ("blue", 0x0000ff),
    ("blueviolet", 0x8a2be2),
    ("brown", 0xa52a2a),
    ("burlywood", 0xdeb887),
    ("cadetblue", 0x5f9ea0),
    ("chartreuse", 0x7fff00),
    ("chocolate", 0xd2691e),
    ("coral", 0xff7f50),
    ("cornflowerblue", 0x6495ed),
    ("cornsilk", 0xfff8dc),
    ("crimson", 0xdc143c),
    ("cyan", 0x00ffff),
    ("darkblue", 0x00008b),
    ("darkcyan", 0x008b8b),
    ("darkgoldenrod", 0xb8860b),
    ("darkgray", 0xa9a9a9),
    ("darkgreen", 0x006400),
    ("darkgrey", 0xa9a9a9),
    ("darkkhaki", 0xbdb76b),
    ("darkmagenta", 0x8b008b),
    ("darkolivegreen", 0x556b2f),
    ("darkorange", 0xff8c00),
    ("darkorchid", 0x9932cc),
    ("darkred", 0x8b0000),
    ("darksalmon", 0xe9967a),
    ("darkseagreen", 0x8fbc8f),
    ("darkslateblue", 0x483d8b),
    ("darkslategray", 0x2f4f4f),
    ("darkslategrey", 0x2f4f4f),
    ("darkturquoise", 0x00ced1),
    ("darkviolet", 0x9400d3),
    ("deeppink", 0xff1493),
    ("deepskyblue", 0x00bfff),
    ("dimgray", 0x696969),
    ("dimgrey", 0x696969),
    ("dodgerblue", 0x1e90ff),
    ("firebrick", 0xb22222),
    ("floralwhite", 0xfffaf0),
    ("forestgreen", 0x228b22),
    ("fuchsia", 0xff00ff),
    ("gainsboro", 0xdcdcdc),
    ("ghostwhite", 0xf8f8ff),
    ("gold", 0xffd700),
    ("goldenrod", 0xdaa520),
    ("gray", 0x808080),
    ("green", 0x008000),
    ("greenyellow", 0xadff2f),
    ("grey", 0x808080),
    ("honeydew", 0xf0fff0),
    ("hotpink", 0xff69b4),
    ("indianred", 0xcd5c5c),
    ("indigo", 0x4b0082),
    ("ivory", 0xfffff0),
    ("khaki", 0xf0e68c),
    ("lavender", 0xe6e6fa),
    ("lavenderblush", 0xfff0f5),
    ("lawngreen", 0x7cfc00),
    ("lemonchiffon", 0xfffacd),
    ("lightblue", 0xadd8e6),
    ("lightcoral", 0xf08080),
    ("lightcyan", 0xe0ffff),
    ("lightgoldenrodyellow", 0xfafad2),
    ("lightgray", 0xd3d3d3),
    ("lightgreen", 0x90ee90),
    ("lightgrey", 0xd3d3d3),
    ("lightpink", 0xffb6c1),
    ("lightsalmon", 0xffa07a),
    ("lightseagreen", 0x20b2aa),
    ("lightskyblue", 0x87cefa),
    ("lightslategray", 0x778899),
    ("lightslategrey", 0x778899),
    ("lightsteelblue", 0xb0c4de),
    ("lightyellow", 0xffffe0),
    ("lime", 0x00ff00),
    ("limegreen", 0x32cd32),
    ("linen", 0xfaf0e6),
    ("magenta", 0xff00ff),
    ("maroon", 0x800000),
    ("mediumaquamarine", 0x66cdaa),
    ("mediumblue", 0x0000cd),
    ("mediumorchid", 0xba55d3),
    ("mediumpurple", 0x9370db),
    ("mediumseagreen", 0x3cb371),
    ("mediumslateblue", 0x7b68ee),
    ("mediumspringgreen", 0x00fa9a),
    ("mediumturquoise", 0x48d1cc),
    ("mediumvioletred", 0xc71585),
    ("midnightblue", 0x191970),
    ("mintcream", 0xf5fffa),
    ("mistyrose", 0xffe4e1),
    ("moccasin", 0xffe4b5),
    ("navajowhite", 0xffdead),
    ("navy", 0x000080),
    ("oldlace", 0xfdf5e6),
    ("olive", 0x808000),
    ("olivedrab", 0x6b8e23),
    ("orange", 0xffa500),
    ("orangered", 0xff4500),
    ("orchid", 0xda70d6),
    ("palegoldenrod", 0xeee8aa),
    ("palegreen", 0x98fb98),
    ("paleturquoise", 0xafeeee),
    ("palevioletred", 0xdb7093),
    ("papayawhip", 0xffefd5),
    ("peachpuff", 0xffdab9),
    ("peru", 0xcd853f),
    ("pink", 0xffc0cb),
    ("plum", 0xdda0dd),
    ("powderblue", 0xb0e0e6),
    ("purple", 0x800080),
    ("rebeccapurple", 0x663399),
    ("red", 0xff0000),
    ("rosybrown", 0xbc8f8f),
    ("royalblue", 0x4169e1),
    ("saddlebrown", 0x8b4513),
    ("salmon", 0xfa8072),
    ("sandybrown", 0xf4a460),
    ("seagreen", 0x2e8b57),
    ("seashell", 0xfff5ee),
    ("sienna", 0xa0522d),
    ("silver", 0xc0c0c0),
    ("skyblue", 0x87ceeb),
    ("slateblue", 0x6a5acd),
    ("slategray", 0x708090),
    ("slategrey", 0x708090),
    ("snow", 0xfffafa),
    ("springgreen", 0x00ff7f),
    ("steelblue", 0x4682b4),
    ("tan", 0xd2b48c),
    ("teal", 0x008080),
    ("thistle", 0xd8bfd8),
    ("tomato", 0xff6347),
    ("turquoise", 0x40e0d0),
    ("violet", 0xee82ee),
    ("wheat", 0xf5deb3),
    ("white", 0xffffff),
    ("whitesmoke", 0xf5f5f5),
    ("yellow", 0xffff00),
    ("yellowgreen", 0x9acd32),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_follow_the_browsers() {
        assert_eq!(number("-1.5"), Some(-1.5));
        assert_eq!(number(".5"), Some(0.5));
        assert_eq!(number("+1e3"), Some(1000.0));
        assert_eq!(number(" 2 "), Some(2.0));
        assert_eq!(number("1."), None);
        assert_eq!(number("1e"), None);
        assert_eq!(number("1e+"), None);
        assert_eq!(number("."), None);
        assert_eq!(number(""), None);
        assert_eq!(number("1e39"), None);
        assert_eq!(number("1 2"), None);
        assert_eq!(number("0x10"), None);
    }

    #[test]
    fn lengths_convert_absolute_units_only() {
        assert_eq!(length("10"), Some(10.0));
        assert_eq!(length("10px"), Some(10.0));
        assert_eq!(length("1in"), Some(96.0));
        assert_eq!(length("72pt"), Some(96.0));
        assert_eq!(length("6pc"), Some(96.0));
        assert!((length("2.54cm").unwrap() - 96.0).abs() < 1e-9);
        assert!((length("25.4mm").unwrap() - 96.0).abs() < 1e-9);
        assert!((length("101.6Q").unwrap() - 96.0).abs() < 1e-9);
        assert_eq!(length("1e2px"), Some(100.0));
        for relative in [
            "10%",
            "1em",
            "1ex",
            "2rem",
            "3ch",
            "1vw",
            "1vh",
            "auto",
            "10PX",
            "1q",
            "calc(1px)",
        ] {
            assert_eq!(length(relative), None, "{relative}");
        }
        assert_eq!(non_negative_length("-1"), None);
        assert_eq!(non_negative_length("0"), Some(0.0));
    }

    #[test]
    fn colors_are_the_listed_forms() {
        assert_eq!(paint("none"), Some(Paint::None));
        assert_eq!(paint("#0072b2"), Some(Paint::Color([0, 0x72, 0xb2])));
        assert_eq!(paint("#FFF"), Some(Paint::Color([255, 255, 255])));
        assert_eq!(
            paint("rebeccapurple"),
            Some(Paint::Color([0x66, 0x33, 0x99]))
        );
        for bad in [
            "Red",
            "currentColor",
            "transparent",
            "inherit",
            "rgb(0,0,0)",
            "#ffff",
            "#12345g",
            "",
            "url(#g)",
        ] {
            assert_eq!(paint(bad), None, "{bad}");
        }
        assert!(NAMED_COLORS.windows(2).all(|w| w[0].0 < w[1].0));
    }

    #[test]
    fn keywords_and_lists() {
        assert!(keyword("display", "none"));
        assert!(!keyword("display", "NONE"));
        assert!(!keyword("display", "inherit"));
        assert!(keyword("font-weight", "700"));
        assert!(!keyword("font-weight", "750"));
        assert!(dasharray("none"));
        assert!(dasharray("5, 3 2mm"));
        assert!(!dasharray("5,,3"));
        assert!(!dasharray("-1"));
        assert!(!dasharray("10%"));
        assert!(!dasharray(""));
        assert!(preserve_aspect_ratio("xMidYMid meet"));
        assert!(preserve_aspect_ratio("none"));
        assert!(!preserve_aspect_ratio("xmidymid"));
        assert!(!preserve_aspect_ratio("xMidYMid meet slice"));
        assert_eq!(
            points("0,0 10-20 1.5.5"),
            Some(vec![[0.0, 0.0], [10.0, -20.0], [1.5, 0.5]])
        );
        assert_eq!(points(""), Some(vec![]));
        assert_eq!(points("1 2 3"), None);
        assert_eq!(points("1,2,"), None);
        assert_eq!(points(",1 2"), None);
    }

    #[test]
    fn transforms_compose_left_to_right() {
        let expected = Matrix([2.0, 0.0, 0.0, 2.0, 10.0, 20.0]);
        assert_eq!(transform("translate(10 20) scale(2)"), Some(expected));
        assert_eq!(transform("translate(10,20)scale(2)"), Some(expected));
        let [a, b, c, d, e, f] = transform("rotate(90 10 10)").unwrap().0;
        let rotated = [a * 20.0 + c * 10.0 + e, b * 20.0 + d * 10.0 + f];
        assert!((rotated[0] - 10.0).abs() < 1e-9 && (rotated[1] - 20.0).abs() < 1e-9);
        assert_eq!(transform(""), Some(Matrix::IDENTITY));
        assert!(transform("matrix(1 0 0 1 0 0)").is_some());
        for bad in [
            "translate(1,)",
            "translate(1),",
            "Translate(1)",
            "rotate(45deg)",
            "scale()",
            "rotate(1 2)",
            "skewX(1 2)",
            "matrix(1 2 3 4 5)",
            "translate 1",
        ] {
            assert_eq!(transform(bad), None, "{bad}");
        }
    }

    #[test]
    fn hrefs_are_classified_like_urls() {
        assert_eq!(href("note.md"), Href::Vault("note.md".into()));
        assert_eq!(href(" /a/b.md#x "), Href::Vault("/a/b.md#x".into()));
        assert_eq!(href("#frag"), Href::Other);
        assert_eq!(href(""), Href::Other);
        assert_eq!(href("//host/a.png"), Href::Other);
        assert_eq!(href("https://example.org/a.png"), Href::Remote);
        assert_eq!(href("mailto:a@b"), Href::Other);
        assert_eq!(
            href("data:image/png;base64,AAAA"),
            Href::Data {
                raster: true,
                bytes: 3
            }
        );
        assert_eq!(
            href("data:image/svg+xml,%3Csvg%2F%3E"),
            Href::Data {
                raster: false,
                bytes: 6
            }
        );
        assert!(is_javascript("java\tscript:alert(1)"));
        assert!(is_javascript(" JavaScript:x"));
        assert!(!is_javascript("javascript.md"));
        assert!(!is_javascript("note/javascript:x"));
    }

    #[test]
    fn local_references_have_one_form() {
        for value in [
            "url(#r1)",
            " url( #r1 ) ",
            "url(\"#r1\")",
            "url('#r1')",
            "URL(#r1)",
            "uRl( '#r1')",
            "url(#r1)\n",
        ] {
            assert_eq!(reference(value), Some("r1"), "{value}");
        }
        for value in [
            "url(r1)",
            "url(#)",
            "url(# r1)",
            "url(#r1",
            "url (#r1)",
            "url(#r1')",
            "url(\"#r1')",
            "url(#r(1))",
            "url(#r\\31)",
            "url(a.svg#r1)",
            "url(#r1) x",
            "url(#r1)url(#r2)",
        ] {
            assert_eq!(reference(value), None, "{value}");
        }
        assert_eq!(reference("url(#sfumatura-è)"), Some("sfumatura-è"));
    }

    #[test]
    fn paints_with_a_resource_and_a_fallback() {
        let with = |id, fallback| Some(PaintReference { id, fallback });
        assert_eq!(paint_reference("url(#r1)"), with("r1", None));
        assert_eq!(paint_reference("url(#r1) "), with("r1", None));
        assert_eq!(
            paint_reference("url(#r1) #ff0000"),
            with("r1", Some(Paint::Color([255, 0, 0])))
        );
        assert_eq!(
            paint_reference(" url(#r1)\tnone "),
            with("r1", Some(Paint::None))
        );
        assert_eq!(
            paint_reference("url(#r1) red"),
            with("r1", Some(Paint::Color([255, 0, 0])))
        );
        for value in [
            "url(#r1)#ff0000",
            "url(#r1) currentColor",
            "url(#r1) url(#r2)",
            "url(#r1) red blue",
            "#ff0000",
            "none",
        ] {
            assert_eq!(paint_reference(value), None, "{value}");
        }
    }

    #[test]
    fn references_inside_any_value() {
        assert_eq!(url_ids("url(#a) url(#b)"), ["a", "b"]);
        assert_eq!(url_ids("fill: url('#a'); stroke: URL( #b )"), ["a", "b"]);
        assert!(url_ids("url(a.png) url(#)").is_empty());
        assert_eq!(url_ids("nourl(#a)"), ["a"]);
        assert_eq!(href_id("#r1").as_deref(), Some("r1"));
        assert_eq!(href_id(" #r1\n").as_deref(), Some("r1"));
        assert_eq!(href_id("#"), None);
        assert_eq!(href_id("a.svg#r1"), None);
    }

    #[test]
    fn fractions_angles_boxes_and_pairs() {
        assert_eq!(percentage("50%"), Some(0.5));
        assert_eq!(percentage(" -10% "), Some(-0.1));
        assert_eq!(percentage("50"), None);
        assert_eq!(percentage("50 %"), None);
        assert_eq!(percentage("%"), None);
        assert_eq!(fraction("0.25"), Some(0.25));
        assert_eq!(fraction("25%"), Some(0.25));
        assert_eq!(fraction("25px"), None);
        assert_eq!(angle("90"), Some(90.0));
        assert_eq!(angle("90deg"), Some(90.0));
        assert_eq!(angle("100grad"), Some(90.0));
        assert!((angle(&format!("{}rad", std::f64::consts::PI)).unwrap() - 180.0).abs() < 1e-10);
        for value in ["", "deg", "90 deg", "90DEG", "1turn", "90degs"] {
            assert_eq!(angle(value), None, "{value}");
        }
        assert_eq!(view_box("0 0 10 20"), Some([0.0, 0.0, 10.0, 20.0]));
        assert_eq!(view_box("-5,-5,10,10"), Some([-5.0, -5.0, 10.0, 10.0]));
        assert_eq!(view_box("0 0 10"), None);
        assert_eq!(view_box("0 0 -1 10"), None);
        assert_eq!(one_or_two("2"), Some(vec![2.0]));
        assert_eq!(one_or_two("2, 3"), Some(vec![2.0, 3.0]));
        assert_eq!(one_or_two(""), None);
        assert_eq!(one_or_two("1 2 3"), None);
        assert_eq!(one_or_two("-1"), None);
    }
}
