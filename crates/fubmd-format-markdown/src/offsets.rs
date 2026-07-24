//! Conversione (riga, colonna) → offset in byte.
//!
//! comrak riporta le posizioni sorgente come riga/colonna 1-based (colonne in
//! byte). Il nostro modello usa `Span` in byte: questa tabella fa il ponte.

pub struct Offsets {
    /// byte di inizio di ogni riga (indice 0 = riga 1).
    line_starts: Vec<usize>,
    len: usize,
}

impl Offsets {
    pub fn new(source: &str) -> Self {
        let mut line_starts = vec![0];
        for (i, b) in source.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push(i + 1);
            }
        }
        Offsets {
            line_starts,
            len: source.len(),
        }
    }

    /// Offset in byte per (riga, colonna) 1-based. Robusto a valori fuori range.
    pub fn byte(&self, line: usize, column: usize) -> usize {
        if line == 0 || line > self.line_starts.len() {
            return self.len;
        }
        let start = self.line_starts[line - 1];
        (start + column.saturating_sub(1)).min(self.len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_line_col_to_byte() {
        let src = "abc\ndef\n";
        let o = Offsets::new(src);
        assert_eq!(o.byte(1, 1), 0);
        assert_eq!(o.byte(2, 1), 4);
        assert_eq!(o.byte(2, 3), 6);
    }
}
