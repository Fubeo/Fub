//! Conversione (riga, colonna) → offset in byte.
//!
//! comrak riporta le posizioni sorgente come riga/colonna 1-based; le colonne
//! espandono i tab a tab-stop. Il nostro modello usa `Span` in byte: questa
//! tabella fa il ponte.
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
//! update` può togliere in silenzio. Adesso è una decisione di Fub, scritta
//! qui, e i test la presidiano su tutte e quattro le forme dello stesso file.

use fub_abi::rules::text_policy;

pub struct Offsets<'a> {
    /// byte di inizio di ogni riga (indice 0 = riga 1).
    line_starts: Vec<usize>,
    /// La sorgente intera. Serve per una cosa sola, e non è la lunghezza: sapere
    /// se un offset cade **in mezzo a un carattere**. Vedi [`Offsets::byte`].
    source: &'a str,
}

impl<'a> Offsets<'a> {
    /// `source` è il sorgente **intero**, BOM compreso: gli offset che questa
    /// tabella produce sono in coordinate del file, non della vista che comrak
    /// ha visto.
    pub fn new(source: &'a str) -> Self {
        // La riga 1 comincia dopo il BOM: è la sola traslazione, ed è qui.
        let mut line_starts = vec![text_policy::bom_len(source)];
        // I terminatori sono **tre**, come in CommonMark: `\n`, `\r\n` e il `\r`
        // nudo. Contarli solo sui `\n` — che è ciò che questa funzione faceva —
        // desincronizza la tabella dalle righe che comrak ha visto al primo `\r`
        // solitario, e da lì in poi **ogni span del documento è sbagliato di
        // righe intere**: una rinomina guidata dallo span di un wikilink
        // riscrive i byte di un'altra riga.
        //
        // Non era visibile perché non produce un errore, produce un numero: su
        // un file interamente a `\r` le righe di comrak finivano tutte oltre la
        // fine della tabella, e `byte` le riportava a `self.len` — cioè span
        // vuoti in coda al file, affettabili e plausibili. Il caso che l'ha
        // scoperto è un `\r` **in mezzo** a un file a `\n`, dove lo scarto è di
        // una riga e due blocchi finiscono per sovrapporsi: l'ha trovato il
        // fuzzer del §17.1, al caso 2779.
        let bytes = source.as_bytes();
        let mut the = 0;
        while the < bytes.len() {
            match bytes[the] {
                b'\n' => {
                    line_starts.push(the + 1);
                    the += 1;
                }
                b'\r' => {
                    // `\r\n` è **un** terminatore, non due righe vuote in mezzo.
                    let salto = if bytes.get(the + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                    line_starts.push(the + salto);
                    the += salto;
                }
                _ => the += 1,
            }
        }
        Offsets {
            line_starts,
            source,
        }
    }

    /// Offset in byte per (riga, colonna) 1-based. Robusto a valori fuori range —
    /// e, che è la parte che conta, **sempre su un confine di carattere**.
    ///
    /// # Perché l'ancoraggio al confine sta qui e non nei chiamanti
    ///
    /// Questa funzione è l'imbuto: ogni [`Span`](fub_abi::model::Span) che il
    /// provider produce passa da qui. Un offset che cade in mezzo a un carattere
    /// non è un difetto di resa, è un **panico**: `&source[a..b]` su un confine
    /// interno va in panico, e lo fa nel primo pezzo di codice che ritaglia quel
    /// pezzo di documento — cioè all'apertura di una nota, addosso all'utente. È
    /// la forma esatta in cui il §17.1 chiede il fuzzing del parser: *«un parser
    /// che pania è un vault che non si apre»*.
    ///
    /// Il caso vero, trovato dal fuzzer del §17.1 al caso 925 396 su una sorgente
    /// di ventiquattro byte: `| a |\n| - |\n e #tag🎉\n`, dove la riga di prosa
    /// **continua** la tabella e la cella che ne nasce finisce a metà dei quattro
    /// byte di `🎉`.
    ///
    /// Si arrotonda **verso il basso**, e la ragione per cui la direzione è quasi
    /// indifferente è che a quel punto il numero è già sbagliato: ciò che questa
    /// riga garantisce non è che l'offset sia giusto, è che nessuno vada in panico
    /// provandoci. Verso il basso ha però una proprietà che serve: è monotona,
    /// quindi due offset ordinati restano ordinati e non nasce uno span invertito.
    pub fn byte(&self, line: usize, column: usize) -> usize {
        let len = self.source.len();
        if line == 0 || line > self.line_starts.len() {
            return len;
        }
        let start = self.line_starts[line - 1];
        let target = column.saturating_sub(1);
        let mut visual = 0;
        let mut at = start;
        while at < len && visual < target {
            let byte = self.source.as_bytes()[at];
            visual += if byte == b'\t' { 4 - (visual % 4) } else { 1 };
            at += 1;
        }
        while !self.source.is_char_boundary(at) {
            at -= 1;
        }
        at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_line_col_to_byte() {
        let src = "abc\ndef\n";
        let or = Offsets::new(src);
        assert_eq!(or.byte(1, 1), 0);
        assert_eq!(or.byte(2, 1), 4);
        assert_eq!(or.byte(2, 3), 6);
    }

    #[test]
    fn expands_tabs_to_comrak_tab_stops() {
        let or = Offsets::new("\tfoo\n");
        assert_eq!(or.byte(1, 1), 0);
        assert_eq!(or.byte(1, 2), 1);
        assert_eq!(or.byte(1, 5), 1);
        assert_eq!(or.byte(1, 6), 2);
    }
}
