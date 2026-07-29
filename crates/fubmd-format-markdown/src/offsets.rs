//! Conversione (riga, colonna) → offset in byte.
//!
//! comrak riporta le posizioni sorgente come riga/colonna 1-based (colonne in
//! byte). Il nostro modello usa `Span` in byte: questa tabella fa il ponte.
//!
//! # Il BOM, e perché la prima riga non comincia sempre a zero (§15.5)
//!
//! Uno `Span` è in byte della sorgente, e la sorgente sono i byte del **file**:
//! BOM compreso. comrak invece vuole del markdown, e un `U+FEFF` in testa al
//! primo blocco è testo — invisibile e comunque testo, che finirebbe nel modello,
//! nell'HTML e nell'indice di ricerca.
//!
//! Le due cose stanno insieme in un modo solo: a comrak si dà
//! `text_policy::strip_bom(source)`, e questa tabella comincia la prima riga a
//! `text_policy::bom_len(source)` invece che a zero. La colonna 1 della riga 1
//! diventa così il primo byte di *contenuto*, e ogni offset che ne esce è nelle
//! coordinate del file — che è ciò che il chiamante di `parse` si aspetta e ciò
//! con cui `apply_edit` andrà a scrivere.
//!
//! Che il risultato sia lo stesso di prima non è una coincidenza ed è il punto:
//! comrak 0.54 salta già il BOM di suo, e i test di `tests/span_e_terminatori.rs`
//! passavano anche senza questo giro. Ma lo saltava **lui**, per un
//! comportamento suo, e una proprietà del nostro contratto che dipende dal
//! comportamento non dichiarato di una dipendenza è una proprietà che una `cargo
//! update` può togliere in silenzio. Adesso è una decisione di FubMD, scritta
//! qui, e i test la presidiano su tutte e quattro le forme dello stesso file.

use fubmd_abi::rules::text_policy;

pub struct Offsets {
    /// byte di inizio di ogni riga (indice 0 = riga 1).
    line_starts: Vec<usize>,
    len: usize,
}

impl Offsets {
    /// `source` è il sorgente **intero**, BOM compreso: gli offset che questa
    /// tabella produce sono in coordinate del file, non della vista che comrak
    /// ha visto.
    pub fn new(source: &str) -> Self {
        // La riga 1 comincia dopo il BOM: è la sola traslazione, ed è qui.
        let mut line_starts = vec![text_policy::bom_len(source)];
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
