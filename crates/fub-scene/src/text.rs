//! Il testo della sorgente: BOM, terminatori di riga e le due coordinate degli
//! span.
//!
//! Una scena ha due lettori di offset. Il provider e l'indice di Fub parlano in
//! **byte UTF-8 sul file intero**, BOM compreso: è la regola di `Span` in
//! `fub-abi` (`crates/fub-abi/src/model.rs`), che qui si riproduce perché
//! `fub-scene` non può importarla. La superficie della shell parla invece in
//! **unità UTF-16 sul testo normalizzato a LF**, come la `DocumentSession` e il
//! `TextEngine`: il BOM è un carattere (`U+FEFF`, un'unità) e ogni `\r\n` o `\r`
//! diventa un solo `\n`. [`Utf16Map`] traduce le prime nelle seconde.

use serde::Serialize;

/// Il BOM UTF-8 come carattere.
pub const BOM: char = '\u{feff}';

/// Quanti byte di BOM ci sono in testa a `source`: `3` oppure `0`.
pub fn bom_len(source: &str) -> usize {
    if source.starts_with(BOM) {
        BOM.len_utf8()
    } else {
        0
    }
}

/// Con che terminatore va a capo un file, come `Newline` di `fub-abi`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    /// `\n`, e anche il file che non va mai a capo.
    Lf,
    /// `\r\n`.
    Crlf,
    /// `\r` da solo.
    Cr,
    /// Più di uno: un file da non peggiorare.
    Mixed,
}

impl LineEnding {
    /// I terminatori che `source` usa davvero.
    pub fn of(source: &str) -> LineEnding {
        let (crlf, lf, cr) = counts(source);
        match (crlf > 0, lf > 0, cr > 0) {
            (true, false, false) => LineEnding::Crlf,
            (false, false, true) => LineEnding::Cr,
            (false, _, false) => LineEnding::Lf,
            _ => LineEnding::Mixed,
        }
    }

    /// Il terminatore di una riga **nuova** dentro `source`: il più frequente;
    /// a pari conteggio `\r\n`, poi `\n`; `\n` se non ce n'è nessuno. È la
    /// regola di `line_break` in `fub-abi`, e non risponde mai
    /// [`Mixed`](LineEnding::Mixed).
    pub fn line_break(source: &str) -> LineEnding {
        let (crlf, lf, cr) = counts(source);
        if crlf == 0 && lf == 0 && cr == 0 {
            LineEnding::Lf
        } else if crlf >= lf && crlf >= cr {
            LineEnding::Crlf
        } else if lf >= cr {
            LineEnding::Lf
        } else {
            LineEnding::Cr
        }
    }
}

/// Quanti `\r\n`, `\n` soli e `\r` soli contiene `source`.
fn counts(source: &str) -> (usize, usize, usize) {
    let bytes = source.as_bytes();
    let (mut crlf, mut lf, mut cr) = (0, 0, 0);
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' if bytes.get(i + 1) == Some(&b'\n') => {
                crlf += 1;
                i += 1;
            }
            b'\r' => cr += 1,
            b'\n' => lf += 1,
            _ => {}
        }
        i += 1;
    }
    (crlf, lf, cr)
}

/// Un intervallo semiaperto `[from, to)` nelle due coordinate.
///
/// `bytes` sono byte UTF-8 sul file intero, BOM compreso; `utf16` sono unità
/// UTF-16 sul testo normalizzato a LF, BOM compreso.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Span {
    pub bytes: [usize; 2],
    pub utf16: [usize; 2],
}

/// Ogni quanti byte [`Utf16Map`] si segna dove si trova.
const STEP: usize = 256;

/// Traduce offset in byte della sorgente in offset UTF-16 sul testo a LF.
///
/// Tiene un segno ogni [`STEP`] byte e da lì conta, così una traduzione costa
/// al massimo un passo di scansione qualunque sia l'ordine delle domande.
pub struct Utf16Map<'a> {
    source: &'a str,
    marks: Vec<(usize, usize)>,
}

impl<'a> Utf16Map<'a> {
    /// La mappa di `source`.
    pub fn new(source: &'a str) -> Self {
        let bytes = source.as_bytes();
        let mut marks = vec![(0, 0)];
        let mut units = 0;
        let mut next = STEP;
        for (i, ch) in source.char_indices() {
            if i >= next {
                marks.push((i, units));
                next = i + STEP;
            }
            units += weight(bytes, i, ch);
        }
        Utf16Map { source, marks }
    }

    /// L'offset UTF-16 sul testo a LF che corrisponde al byte `offset`.
    ///
    /// `offset` deve cadere su un confine di carattere. Un offset fra `\r` e
    /// `\n` vale quanto quello prima del `\r`: nel testo a LF la coppia è un
    /// carattere solo.
    pub fn offset(&self, offset: usize) -> usize {
        let at = self.marks.partition_point(|&(byte, _)| byte <= offset) - 1;
        let (start, mut units) = self.marks[at];
        let bytes = self.source.as_bytes();
        for (i, ch) in self.source[start..offset].char_indices() {
            units += weight(bytes, start + i, ch);
        }
        units
    }

    /// Lo [`Span`] dei byte `[from, to)`.
    pub fn span(&self, from: usize, to: usize) -> Span {
        Span {
            bytes: [from, to],
            utf16: [self.offset(from), self.offset(to)],
        }
    }
}

/// Quante unità UTF-16 vale nel testo a LF il carattere `ch` al byte `i`: un
/// `\r` seguito da `\n` non vale niente, perché la coppia diventa il solo `\n`.
fn weight(bytes: &[u8], i: usize, ch: char) -> usize {
    if ch == '\r' && bytes.get(i + 1) == Some(&b'\n') {
        0
    } else {
        ch.len_utf16()
    }
}

/// L'inizio di ogni riga di una sorgente, per trovare il rientro di un byte
/// senza tornare indietro fino a capo: un SVG minificato è una riga sola con
/// decine di migliaia di elementi.
pub(crate) struct Lines<'a> {
    source: &'a str,
    /// Il primo byte di ogni riga; la prima comincia dopo il BOM.
    starts: Vec<usize>,
}

impl<'a> Lines<'a> {
    pub fn new(source: &'a str) -> Self {
        let bytes = source.as_bytes();
        let mut starts = vec![bom_len(source)];
        for (i, &b) in bytes.iter().enumerate() {
            // `\r\n` va a capo una volta sola, dopo `\n`.
            if b == b'\n' || (b == b'\r' && bytes.get(i + 1) != Some(&b'\n')) {
                starts.push(i + 1);
            }
        }
        Lines { source, starts }
    }

    /// Il rientro della riga su cui comincia il byte `offset`: gli spazi e le
    /// tabulazioni in testa alla riga, fino a `offset` al più.
    pub fn indent(&self, offset: usize) -> &'a str {
        let line = self.starts.partition_point(|&start| start <= offset);
        let start = self.starts[line.saturating_sub(1)].min(offset);
        let head = &self.source.as_bytes()[start..offset];
        let end = head
            .iter()
            .position(|&b| b != b' ' && b != b'\t')
            .unwrap_or(head.len());
        &self.source[start..start + end]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Il testo che vede la shell: `\r\n` e `\r` diventano `\n`.
    fn normalized(source: &str) -> String {
        source.replace("\r\n", "\n").replace('\r', "\n")
    }

    #[test]
    fn utf16_offsets_follow_the_lf_text_of_the_shell() {
        let source = "\u{feff}a\r\nb\rc\n😀é\r\n<g/>";
        let map = Utf16Map::new(source);
        let text = normalized(source);
        for (byte, _) in source.char_indices().chain([(source.len(), ' ')]) {
            let units = map.offset(byte);
            let prefix = &source[..byte];
            // Un offset fra `\r` e `\n` vale quello prima del `\r`.
            let inside_crlf = prefix.ends_with('\r') && source[byte..].starts_with('\n');
            let prefix = if inside_crlf {
                &prefix[..byte - 1]
            } else {
                prefix
            };
            let expected = normalized(prefix).encode_utf16().count();
            assert_eq!(units, expected, "byte {byte}");
        }
        assert_eq!(map.offset(source.len()), text.encode_utf16().count());
    }

    #[test]
    fn utf16_offsets_cross_the_marks() {
        let line = "é\r\n".repeat(400);
        let map = Utf16Map::new(&line);
        assert_eq!(map.offset(line.len()), 800);
        assert_eq!(map.offset(4 * 150), 300);
    }

    #[test]
    fn line_endings_are_observed_not_converted() {
        assert_eq!(LineEnding::of("a"), LineEnding::Lf);
        assert_eq!(LineEnding::of("a\nb"), LineEnding::Lf);
        assert_eq!(LineEnding::of("a\r\nb"), LineEnding::Crlf);
        assert_eq!(LineEnding::of("a\rb"), LineEnding::Cr);
        assert_eq!(LineEnding::of("a\r\nb\n"), LineEnding::Mixed);
        assert_eq!(LineEnding::line_break("a"), LineEnding::Lf);
        assert_eq!(LineEnding::line_break("a\r\nb\n"), LineEnding::Crlf);
        assert_eq!(LineEnding::line_break("a\r\nb\nc\n"), LineEnding::Lf);
        assert_eq!(LineEnding::line_break("a\rb\rc\n"), LineEnding::Cr);
    }

    #[test]
    fn the_indent_is_the_head_of_the_line() {
        let source = "\u{feff}<svg>\r\n  \t<g/>\n<a/>\r  <b/> <c/>";
        let lines = Lines::new(source);
        assert_eq!(lines.indent(source.find("<g").unwrap()), "  \t");
        assert_eq!(lines.indent(source.find("<a").unwrap()), "");
        assert_eq!(lines.indent(source.find("<b").unwrap()), "  ");
        assert_eq!(lines.indent(source.find("<c").unwrap()), "  ");
        assert_eq!(lines.indent(3), "");
        assert_eq!(lines.indent(0), "");
        assert_eq!(bom_len(source), 3);
    }
}
