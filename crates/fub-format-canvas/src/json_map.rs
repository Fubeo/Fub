//! Mappa esatta fra testo decodificato e byte JSON grezzi, legata al percorso.
//!
//! Un literale `"..."` nel sorgente e il suo valore decodificato hanno due
//! sistemi di coordinate diversi non appena c'è un escape (`\n` sono 2 byte
//! grezzi per 1 decodificato, `\u00e9` sono 6 per 2, una surrogate pair 12
//! per 4). Sommare la base del literale all'offset decodificato è corretto
//! solo senza escape — con escape sposta gli span, e con link ripetuti la
//! ricerca per contenuto riscrive l'occorrenza sbagliata.
//!
//! Questa mappa registra, per ogni char decodificato, l'intervallo di byte
//! grezzi che lo ha prodotto (relativo all'inizio del contenuto, dopo la
//! virgoletta). Parse e rewrite la usano in entrambi i versi:
//! decodificato→grezzo per emettere span assoluti esatti, e grezzo→decodificato
//! per verificare gli span in arrivo, sostituendo solo i byte dello span
//! richiesto e preservando escape e unknown circostanti.
//!
//! I literali sono legati al **percorso JSON** (`nodes[i].text`,
//! `nodes[i].file`, `edges[j].label`), mai cercati per chiave+valore in tutto
//! il file: un `"text": "[[X]]"` dentro `extra`, alla radice o in un'altra
//! card non è mai scambiato per quello del nodo corrente, a prescindere da
//! chiavi arbitrarie e ordinamenti. Campi noti duplicati nello stesso oggetto
//! sono rifiutati: il parser tipizzato li risolverebbe last-wins in silenzio,
//! e un'associazione ambigua non deve mai nascere.

/// Un char decodificato e i byte grezzi che lo hanno prodotto.
#[derive(Clone, Copy, Debug)]
pub(crate) struct CharMap {
    pub dec_start: usize,
    pub dec_end: usize,
    pub raw_start: usize,
    pub raw_end: usize,
}

/// Quale campo link-bearing di un nodo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CanvasField {
    Text,
    File,
    Url,
    Label,
}

/// Percorso strutturale di un literale: il nodo/arco che lo contiene.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LiteralPath {
    Node { index: usize, field: CanvasField },
    Edge { index: usize },
}

/// Un valore stringa nel sorgente, con percorso, span e mappa.
#[derive(Clone, Debug)]
pub(crate) struct MappedLiteral {
    pub path: LiteralPath,
    pub decoded: String,
    pub content_start: usize,
    pub content_end: usize,
    pub map: Vec<CharMap>,
}

/// Legge una stringa JSON da `at` (virgoletta inclusa): valore decodificato,
/// mappa per char (raw relativo all'inizio del contenuto) e offset dopo la
/// virgoletta chiusa. `None` se malformata.
pub(crate) fn read_mapped(source: &str, at: usize) -> Option<(String, Vec<CharMap>, usize)> {
    let bytes = source.as_bytes();
    if bytes.get(at) != Some(&b'"') {
        return None;
    }
    let mut out = String::new();
    let mut map = Vec::new();
    // Raw relativo al contenuto (at + 1): la virgoletta non fa parte della mappa.
    let mut raw = 0usize;
    let mut i = at + 1;
    // Registra il char appena spinto, con i raw consumati da `from`.
    macro_rules! push {
        ($ch:expr, $from:expr) => {{
            let dec_start = out.len();
            out.push($ch);
            map.push(CharMap {
                dec_start,
                dec_end: out.len(),
                raw_start: $from,
                raw_end: raw,
            });
        }};
    }
    while i < bytes.len() {
        match bytes[i] {
            b'"' => return Some((out, map, i + 1)),
            b'\\' => {
                let from = raw;
                i += 1;
                raw += 1;
                match bytes.get(i) {
                    Some(b'"') => {
                        raw += 1;
                        push!('"', from);
                    }
                    Some(b'\\') => {
                        raw += 1;
                        push!('\\', from);
                    }
                    Some(b'/') => {
                        raw += 1;
                        push!('/', from);
                    }
                    Some(b'b') => {
                        raw += 1;
                        push!('\u{0008}', from);
                    }
                    Some(b'f') => {
                        raw += 1;
                        push!('\u{000C}', from);
                    }
                    Some(b'n') => {
                        raw += 1;
                        push!('\n', from);
                    }
                    Some(b'r') => {
                        raw += 1;
                        push!('\r', from);
                    }
                    Some(b't') => {
                        raw += 1;
                        push!('\t', from);
                    }
                    Some(b'u') => {
                        let hex = source.get(i + 1..i + 5)?;
                        let code = u32::from_str_radix(hex, 16).ok()?;
                        raw += 5;
                        if (0xD800..0xDC00).contains(&code) {
                            let rest = source.get(i + 5..)?;
                            if rest.starts_with("\\u") {
                                let hex2 = source.get(i + 7..i + 11)?;
                                let code2 = u32::from_str_radix(hex2, 16).ok()?;
                                if !(0xDC00..0xE000).contains(&code2) {
                                    return None;
                                }
                                let full = 0x10000 + ((code - 0xD800) << 10) + (code2 - 0xDC00);
                                raw += 6;
                                push!(char::from_u32(full)?, from);
                            } else {
                                return None;
                            }
                        } else {
                            push!(char::from_u32(code)?, from);
                        }
                        i += 4;
                    }
                    _ => return None,
                }
                i += 1;
            }
            _ => {
                let ch = source[i..].chars().next()?;
                let from = raw;
                raw += ch.len_utf8();
                // `raw` qui conta byte sorgente = byte del char: il grezzo non
                // ha escape su questo char, 1:1.
                push!(ch, from);
                i += ch.len_utf8();
            }
        }
    }
    None
}

struct Lexer<'a> {
    source: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Lexer<'a> {
    fn ws(&mut self) {
        while self.pos < self.bytes.len()
            && matches!(self.bytes[self.pos], b' ' | b'\t' | b'\n' | b'\r')
        {
            self.pos += 1;
        }
    }

    fn eat(&mut self, byte: u8) -> bool {
        if self.bytes.get(self.pos) == Some(&byte) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    /// Chiave oggetto (`"..."` decodificata) o `None` su `}`/fine.
    fn key(&mut self) -> Result<Option<String>, String> {
        self.ws();
        match self.bytes.get(self.pos) {
            Some(b'"') => {
                let src = self.source;
                let (key, _, end) =
                    read_mapped(src, self.pos).ok_or_else(|| "invalid JSON string".to_string())?;
                self.pos = end;
                Ok(Some(key))
            }
            _ => Ok(None),
        }
    }

    fn colon(&mut self) -> Result<(), String> {
        self.ws();
        if self.eat(b':') {
            Ok(())
        } else {
            Err("expected ':' in canvas JSON".to_string())
        }
    }

    fn literal(&mut self, word: &str) -> Result<(), String> {
        if self.source[self.pos..].starts_with(word)
            && self.source[self.pos..].chars().next().is_some()
        {
            self.pos += word.len();
            Ok(())
        } else {
            Err(format!("invalid JSON value near offset {}", self.pos))
        }
    }

    fn skip_number(&mut self) -> Result<(), String> {
        let start = self.pos;
        if self.eat(b'-') {
            // Segno consumato, le cifre seguono.
        }
        let mut digits = 0;
        while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
            self.pos += 1;
            digits += 1;
        }
        if self.bytes.get(self.pos) == Some(&b'.') {
            self.pos += 1;
            while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
                self.pos += 1;
                digits += 1;
            }
        }
        if matches!(self.bytes.get(self.pos), Some(b'e') | Some(b'E')) {
            self.pos += 1;
            if matches!(self.bytes.get(self.pos), Some(b'+') | Some(b'-')) {
                self.pos += 1;
            }
            let mut exp = 0;
            while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
                self.pos += 1;
                exp += 1;
            }
            if exp == 0 {
                return Err("invalid JSON number".to_string());
            }
        }
        if digits == 0 || self.pos == start {
            return Err("invalid JSON number".to_string());
        }
        Ok(())
    }

    fn skip_value(&mut self) -> Result<(), String> {
        self.ws();
        match self.bytes.get(self.pos) {
            Some(b'"') => {
                let src = self.source;
                let (_, _, end) =
                    read_mapped(src, self.pos).ok_or_else(|| "invalid JSON string".to_string())?;
                self.pos = end;
                Ok(())
            }
            Some(b'{') => self.skip_object(),
            Some(b'[') => self.skip_array(),
            Some(b't') => self.literal("true"),
            Some(b'f') => self.literal("false"),
            Some(b'n') => self.literal("null"),
            Some(b'-') | Some(b'0'..=b'9') => self.skip_number(),
            _ => Err(format!("invalid JSON value near offset {}", self.pos)),
        }
    }

    fn skip_object(&mut self) -> Result<(), String> {
        if !self.eat(b'{') {
            return Err("expected '{'".to_string());
        }
        loop {
            self.ws();
            if self.eat(b'}') {
                return Ok(());
            }
            match self.key()? {
                Some(_) => {}
                None => return Err("expected object key".to_string()),
            }
            self.colon()?;
            self.skip_value()?;
            self.ws();
            if self.eat(b',') {
                continue;
            }
            if self.eat(b'}') {
                return Ok(());
            }
            return Err("expected ',' or '}'".to_string());
        }
    }

    fn skip_array(&mut self) -> Result<(), String> {
        if !self.eat(b'[') {
            return Err("expected '['".to_string());
        }
        loop {
            self.ws();
            if self.eat(b']') {
                return Ok(());
            }
            self.skip_value()?;
            self.ws();
            if self.eat(b',') {
                continue;
            }
            if self.eat(b']') {
                return Ok(());
            }
            return Err("expected ',' or ']'".to_string());
        }
    }
}

/// Tutti i literali link-bearing della tela, legati al percorso strutturale.
/// `nodes[i].text|file|url|label` ed `edges[j].label`; ogni altra stringa —
/// radice, `id`, `color`, `subpath`, `background` e qualunque `extra` a
/// qualunque profondità — è saltata e non è mai un candidato, a prescindere
/// da chiave e valore. L'ordine delle chiavi nel file è arbitrario: i nodi si
/// contano nell'ordine dell'array `nodes`, gli archi in quello di `edges`.
pub(crate) fn canvas_literals(source: &str) -> Result<Vec<MappedLiteral>, String> {
    let mut lx = Lexer {
        source,
        bytes: source.as_bytes(),
        pos: 0,
    };
    let mut out = Vec::new();
    lx.ws();
    if !lx.eat(b'{') {
        return Err("canvas JSON must be an object".to_string());
    }
    let mut seen_root: Option<bool> = None;
    let mut seen_edges = false;
    let mut seen_nodes = false;
    let _ = seen_root.take();
    loop {
        lx.ws();
        if lx.eat(b'}') {
            break;
        }
        let key = match lx.key()? {
            Some(key) => key,
            None => return Err("expected object key in canvas".to_string()),
        };
        lx.colon()?;
        match key.as_str() {
            "nodes" => {
                if seen_nodes {
                    return Err("duplicate \"nodes\" in canvas".to_string());
                }
                seen_nodes = true;
                lx.ws();
                if !lx.eat(b'[') {
                    return Err("\"nodes\" must be an array".to_string());
                }
                let mut index = 0;
                loop {
                    lx.ws();
                    if lx.eat(b']') {
                        break;
                    }
                    parse_node(&mut lx, &mut out, index)?;
                    index += 1;
                    lx.ws();
                    if lx.eat(b',') {
                        continue;
                    }
                    if lx.eat(b']') {
                        break;
                    }
                    return Err("expected ',' or ']' in nodes array".to_string());
                }
            }
            "edges" => {
                if seen_edges {
                    return Err("duplicate \"edges\" in canvas".to_string());
                }
                seen_edges = true;
                lx.ws();
                if !lx.eat(b'[') {
                    return Err("\"edges\" must be an array".to_string());
                }
                let mut index = 0;
                loop {
                    lx.ws();
                    if lx.eat(b']') {
                        break;
                    }
                    parse_edge(&mut lx, &mut out, index)?;
                    index += 1;
                    lx.ws();
                    if lx.eat(b',') {
                        continue;
                    }
                    if lx.eat(b']') {
                        break;
                    }
                    return Err("expected ',' or ']' in edges array".to_string());
                }
            }
            _ => {
                lx.skip_value()?;
            }
        }
        lx.ws();
        if lx.eat(b',') {
            continue;
        }
        if lx.eat(b'}') {
            break;
        }
        return Err("expected ',' or '}' in canvas".to_string());
    }
    lx.ws();
    if lx.pos != lx.bytes.len() {
        return Err("trailing data after canvas JSON".to_string());
    }
    Ok(out)
}

fn record_string(
    lx: &mut Lexer<'_>,
    out: &mut Vec<MappedLiteral>,
    path: LiteralPath,
) -> Result<(), String> {
    lx.ws();
    if lx.bytes.get(lx.pos) != Some(&b'"') {
        // Campo noto con valore non-stringa: il parser tipizzato lo rifiuta;
        // qui si salta e sarà lui a dirlo.
        return lx.skip_value();
    }
    let at = lx.pos;
    let src = lx.source;
    let (decoded, map, end) =
        read_mapped(src, at).ok_or_else(|| "invalid JSON string".to_string())?;
    out.push(MappedLiteral {
        path,
        decoded,
        content_start: at + 1,
        content_end: end - 1,
        map,
    });
    lx.pos = end;
    Ok(())
}

fn parse_node(
    lx: &mut Lexer<'_>,
    out: &mut Vec<MappedLiteral>,
    index: usize,
) -> Result<(), String> {
    if !lx.eat(b'{') {
        return Err("canvas node must be an object".to_string());
    }
    let mut seen: Vec<String> = Vec::new();
    loop {
        lx.ws();
        if lx.eat(b'}') {
            return Ok(());
        }
        let key = match lx.key()? {
            Some(key) => key,
            None => return Err("expected key in canvas node".to_string()),
        };
        if seen.contains(&key) {
            return Err(format!("duplicate field {key:?} in canvas node"));
        }
        seen.push(key.clone());
        lx.colon()?;
        let field = match key.as_str() {
            "text" => Some(CanvasField::Text),
            "file" => Some(CanvasField::File),
            "url" => Some(CanvasField::Url),
            "label" => Some(CanvasField::Label),
            _ => None,
        };
        match field {
            Some(field) => record_string(lx, out, LiteralPath::Node { index, field })?,
            None => lx.skip_value()?,
        }
        lx.ws();
        if lx.eat(b',') {
            continue;
        }
        if lx.eat(b'}') {
            return Ok(());
        }
        return Err("expected ',' or '}' in canvas node".to_string());
    }
}

fn parse_edge(
    lx: &mut Lexer<'_>,
    out: &mut Vec<MappedLiteral>,
    index: usize,
) -> Result<(), String> {
    if !lx.eat(b'{') {
        return Err("canvas edge must be an object".to_string());
    }
    let mut seen: Vec<String> = Vec::new();
    loop {
        lx.ws();
        if lx.eat(b'}') {
            return Ok(());
        }
        let key = match lx.key()? {
            Some(key) => key,
            None => return Err("expected key in canvas edge".to_string()),
        };
        if seen.contains(&key) {
            return Err(format!("duplicate field {key:?} in canvas edge"));
        }
        seen.push(key.clone());
        lx.colon()?;
        if key == "label" {
            record_string(lx, out, LiteralPath::Edge { index })?;
        } else {
            lx.skip_value()?;
        }
        lx.ws();
        if lx.eat(b',') {
            continue;
        }
        if lx.eat(b'}') {
            return Ok(());
        }
        return Err("expected ',' or '}' in canvas edge".to_string());
    }
}

/// Literale del campo di un nodo, o `None` se assente.
pub(crate) fn find_node_literal(
    literals: &[MappedLiteral],
    index: usize,
    field: CanvasField,
) -> Option<&MappedLiteral> {
    literals
        .iter()
        .find(|lit| lit.path == LiteralPath::Node { index, field })
}

/// Literale `label` di un arco, o `None` se assente.
pub(crate) fn find_edge_literal(
    literals: &[MappedLiteral],
    index: usize,
) -> Option<&MappedLiteral> {
    literals
        .iter()
        .find(|lit| lit.path == LiteralPath::Edge { index })
}

/// Entrambi gli estremi devono cadere su confini di char decodificati,
/// altrimenti `None`: uno span a metà char (o fuori dal testo) non si
/// rimappa, si rifiuta.
pub(crate) fn decoded_to_raw(
    map: &[CharMap],
    raw_content_len: usize,
    start: usize,
    end: usize,
) -> Option<(usize, usize)> {
    let total = map.last().map(|m| m.dec_end).unwrap_or(0);
    if start > end || end > total {
        return None;
    }
    let rs = if start == total {
        raw_content_len
    } else {
        let m = map.iter().find(|m| m.dec_start == start)?;
        m.raw_start
    };
    let re = if end == total {
        raw_content_len
    } else {
        let m = map.iter().find(|m| m.dec_end == end)?;
        m.raw_end
    };
    (rs <= re).then_some((rs, re))
}

/// Byte grezzi (relativi all'inizio del contenuto) → testo decodificato.
/// Cerca l'intervallo decodificato la cui copertura raw è esattamente
/// `rel_start..rel_end`; `None` se lo span taglia una sequenza di escape o un
/// char a metà: non si rimappa, si rifiuta.
pub(crate) fn raw_to_decoded(
    map: &[CharMap],
    raw_content_len: usize,
    rel_start: usize,
    rel_end: usize,
) -> Option<(usize, usize)> {
    if rel_start > rel_end || rel_end > raw_content_len {
        return None;
    }
    let ds = if rel_start == raw_content_len {
        map.last().map(|m| m.dec_end).unwrap_or(0)
    } else {
        map.iter().find(|m| m.raw_start == rel_start)?.dec_start
    };
    let de = if rel_end == raw_content_len {
        map.last().map(|m| m.dec_end).unwrap_or(0)
    } else {
        map.iter().find(|m| m.raw_end == rel_end)?.dec_end
    };
    (ds <= de).then_some((ds, de))
}
