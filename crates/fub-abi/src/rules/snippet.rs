//! Quanto testo di un documento entra in una riga di risultato — e chi lo
//! decide.
//!
//! Una riga di risultato (uno **snippet**) è ciò che l'utente legge di un
//! documento senza aprirlo: la riga di un risultato di ricerca, e la riga di
//! un backlink. Sono lo stesso artefatto — una riga sola, troncata dal CSS
//! (`white-space: nowrap; text-overflow: ellipsis`) — e fanno la stessa
//! domanda: «quanto testo basta a riconoscere il contesto?». La risposta è
//! una, e questo modulo è l'unico posto in cui sta scritta: `SNIPPET_CHARS` è
//! nata in `fub-features/src/search.rs` per gli estratti di ricerca, e la
//! §25.4 l'ha presa per il contesto dei backlink. Un tetto solo, non due:
//! due costanti per la stessa domanda divergono in silenzio (0128), e chi ne
//! cambia una non sa se cambiare l'altra.
//!
//! Il tetto resta una **costante Rust e non entra nel contratto** (decisione
//! 0094): il WIT non lo dice, nessun provider è obbligato a interrogarlo, e
//! chi lo supera se ne accorge perché il testo tagliato porta l'ellissi. È
//! anche per questo che sta in `fub-abi::rules` (decisione 0020): il provider
//! WASM di M5 lo eredita dal contratto invece di reinventarlo.
//!
//! # Caratteri, non byte
//!
//! Il tetto conta **caratteri** (scalar Unicode), non byte: 220 caratteri CJK
//! sono 660 byte. La metrica giusta è la riga visibile — il CSS tronca in
//! pixel — e un tetto in byte darebbe righe di lunghezza diversa a seconda
//! della lingua. Il taglio cade su un confine di carattere (`char_indices`):
//! non può mai spezzare un `char`, e un'emoji ZWJ può essere divisa a metà —
//! è il limite dichiarato, e l'ellissi ai bordi lo rende visibile.
//!
//! # Che cosa NON è questo tetto
//!
//! I tetti di altre specie restano di altre specie e non si fondono con
//! questo: il tetto del canale degli eventi (`rules::events`, §20.5) limita
//! una coda, `MAX_RANDOM_BYTES` (0094) limita una richiesta di entropia,
//! `MAX_SEGMENT_BYTES` (`rules::path_policy`) limita un nome su un
//! filesystem. Questo tetto limita una **riga di risultato**, e nient'altro.
//!
//! # Il confine con `text_policy`
//!
//! `rules::text_policy` dichiara che lì «non c'è nessuna funzione che
//! restituisca un `String` diverso da quello che le è stato dato»: un modulo
//! che normalizzasse i byte romperebbe la promessa del catalogo, *«un `git
//! diff` che mostra righe che l'utente non ha scritto è un difetto»*. Questo
//! modulo è la prima regola che fa l'opposto — ritaglia e restituisce un
//! `String` nuovo — ed è proprio il suo mestiere: il contesto di un backlink
//! non è un file che Fub deve lasciare identico, è una riga da mostrare.

use std::ops::Range;

/// Quanti caratteri di testo porta al massimo una riga di risultato: lo
/// snippet di ricerca e il contesto di un backlink.
///
/// Nata in `fub-features/src/search.rs` per gli estratti di tantivy, spostata
/// qui perché la §25.4 ha dato la stessa risposta alla stessa domanda per i
/// backlink — un tetto solo, in un posto solo. In **caratteri**, non byte
/// (220 caratteri CJK sono 660 byte): la metrica è la riga visibile.
pub const SNIPPET_CHARS: usize = 220;

/// La finestra di [`SNIPPET_CHARS`] caratteri di `text` che contiene il link.
///
/// `link` è l'intervallo del link in `text`, in byte, `[inizio, fine)` —
/// registrato dal chiamante mentre costruisce il testo del blocco, sul testo
/// **non trimmato** (un trim in testa sposterebbe le posizioni). Se il testo
/// sta nel tetto, il risultato è `text.trim()` — identico a prima della
/// regola. Se lo supera, il risultato è una finestra che contiene il link
/// **intero** (mai tagliato: è il riferimento di cui la riga parla), con `…`
/// ai bordi tagliati; l'ellissi è fuori dal tetto, quindi al massimo si
/// mostrano `SNIPPET_CHARS + 2` caratteri.
///
/// Un'etichetta più lunga del tetto (praticamente impossibile nel testo
/// renderizzato) si conserva intera: è il ramo esplicito qui sotto, non un
/// effetto della saturazione. E una finestra che dopo il trim resta vuota —
/// un link senza etichetta in mezzo a solo bianco — torna `""`: un contesto
/// vuoto non è un contesto, e il chiamante lo tratta come `None`.
pub fn window(text: &str, link: Range<usize>) -> String {
    let mut start = link.start.min(text.len());
    let mut end = link.end.min(text.len());
    if end < start {
        std::mem::swap(&mut start, &mut end);
    }
    // Il chiamante registra posizioni su confini di carattere per costruzione;
    // la normalizzazione qui è una difesa in profondità (mai un panic in
    // release), e l'assert fa morire un disallineamento nei banchi.
    debug_assert!(
        text.is_char_boundary(start) && text.is_char_boundary(end),
        "la posizione del link nel testo non è su un confine di carattere: {start}..{end}"
    );
    let start = floor_char_boundary(text, start);
    let end = ceil_char_boundary(text, end);

    let n = text.chars().count();
    if n <= SNIPPET_CHARS {
        return text.trim().to_string();
    }
    let link_chars = text[start..end].chars().count();
    let (from, to) = if link_chars >= SNIPPET_CHARS {
        // L'etichetta non sta nel tetto: la finestra è il link intero, col
        // resto del testo come margine. Caso dichiarato e provato, non una
        // saturazione silenziosa.
        (start, end)
    } else {
        // Il margine attorno al link è ciò che resta del tetto, diviso in
        // due: `link_chars < SNIPPET_CHARS` per il ramo qui sopra, quindi
        // questa sottrazione non può andare sottozero.
        let margin = (SNIPPET_CHARS - link_chars) / 2;
        let link_start = text[..start].chars().count();
        let mut from = link_start.saturating_sub(margin);
        let mut to = from + SNIPPET_CHARS;
        if to > n {
            // Il link è a meno di una finestra dalla fine: la finestra
            // retrocede per non sprecare il tetto, e l'ellissi passa in testa.
            to = n;
            from = to.saturating_sub(SNIPPET_CHARS);
        }
        (char_nth_byte(text, from), char_nth_byte(text, to))
    };
    let slice = text[from..to].trim();
    if slice.is_empty() {
        return String::new();
    }
    let mut out = String::with_capacity(slice.len() + 2);
    if from > 0 {
        out.push('…');
    }
    out.push_str(slice);
    if to < text.len() {
        out.push('…');
    }
    out
}

/// L'offset in byte del carattere `k`-esimo (0-based) di `text`.
fn char_nth_byte(text: &str, k: usize) -> usize {
    text.char_indices()
        .nth(k)
        .map(|(the, _)| the)
        .unwrap_or(text.len())
}

/// Il confine di carattere più vicino a `i` senza superarlo.
///
/// Sono i metodi `str::{floor,ceil}_char_boundary` (stabili da 1.91),
/// implementati qui perché l'MSRV del workspace è 1.89 — e sono le stesse due
/// righe che quei metodi contengono.
fn floor_char_boundary(text: &str, the: usize) -> usize {
    let mut the = the.min(text.len());
    while !text.is_char_boundary(the) {
        the -= 1;
    }
    the
}

/// Il confine di carattere più vicino a `i` senza scenderci sotto.
fn ceil_char_boundary(text: &str, the: usize) -> usize {
    let mut the = the.min(text.len());
    while !text.is_char_boundary(the) {
        the += 1;
    }
    the
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_comes_back_trimmed_untouched() {
        assert_eq!(window("  breve  ", 0..0), "breve");
        assert_eq!(window("Vedi Nota qui.", 5..9), "Vedi Nota qui.");
    }

    #[test]
    fn the_cap_is_exact() {
        // 220 caratteri: nessuna ellissi, uguaglianza col testo. 221: l'ultimo
        // carattere si taglia e l'ellissi lo dice.
        let due20 = format!("{}{}", "parole ".repeat(31), "abc"); // 217 + 3
        assert_eq!(due20.chars().count(), SNIPPET_CHARS);
        assert_eq!(window(&due20, 100..105), due20);
        let ctx = window(&format!("{due20}!"), 100..105);
        assert!(ctx.ends_with('…'));
        assert_eq!(ctx.chars().count(), SNIPPET_CHARS + 1);
    }

    #[test]
    fn a_cut_on_the_right_wears_a_trailing_ellipsis() {
        // Link a 3 caratteri dall'inizio: niente ellissi in testa, una in coda.
        // La fetta finisce con uno spazio ("parole " × 31 dopo "abc") e il
        // trim lo toglie: 219 caratteri + l'ellissi.
        let text = format!("abc{}", "parole ".repeat(40));
        let ctx = window(&text, 0..3);
        assert!(ctx.starts_with("abc"));
        assert!(!ctx.starts_with('…'));
        assert!(ctx.ends_with('…'));
        assert_eq!(ctx.chars().count(), SNIPPET_CHARS);
    }

    #[test]
    fn a_cut_on_the_left_wears_a_leading_ellipsis() {
        // Link a 3 caratteri dalla fine: niente ellissi in coda, una in testa.
        let text = format!("{}abc", "parole ".repeat(40));
        let n = text.len();
        let ctx = window(&text, n - 3..n);
        assert!(ctx.ends_with("abc"));
        assert!(!ctx.ends_with('…'));
        assert!(ctx.starts_with('…'));
        assert_eq!(ctx.chars().count(), SNIPPET_CHARS + 1);
    }

    #[test]
    fn a_cut_on_both_sides_wears_two_ellipses() {
        let text = format!("{}LINK{}", "parole ".repeat(40), "parole ".repeat(40));
        let start = text.find("LINK").unwrap();
        let ctx = window(&text, start..start + 4);
        assert!(ctx.contains("LINK"));
        assert!(ctx.starts_with('…') && ctx.ends_with('…'));
        assert_eq!(ctx.chars().count(), SNIPPET_CHARS + 2);
    }

    #[test]
    fn the_window_never_splits_a_char() {
        // Accenti (2 byte), CJK (3), emoji (4) e una famiglia ZWJ (11 char
        // per cluster): il taglio cade su confini di carattere e il risultato
        // contiene il link per intero.
        let text = format!(
            "{} {} {} {}",
            "però città perché così ".repeat(20),
            "日本語のテキスト".repeat(20),
            "🎉".repeat(50),
            "👨‍👩‍👧‍👦".repeat(20),
        );
        let start = text.find("日本語").unwrap();
        let ctx = window(&text, start..start + "日本語".len());
        assert!(ctx.contains("日本語"));
        assert!(ctx.chars().count() <= SNIPPET_CHARS + 2);
    }

    #[test]
    fn a_label_longer_than_the_cap_is_kept_whole() {
        // Il ramo esplicito: un'etichetta che non sta nel tetto si conserva
        // intera, con le ellissi ai lati se c'è altro testo.
        let label = "e".repeat(300);
        let text = format!("pre {label} post");
        let start = text.find(&label).unwrap();
        let ctx = window(&text, start..start + 300);
        assert!(ctx.contains(&label));
        assert!(ctx.starts_with('…') && ctx.ends_with('…'));
        // E senza testo attorno: il link è il testo, niente ellissi.
        assert_eq!(window(&label, 0..300), label);
    }

    #[test]
    fn an_all_whitespace_window_is_empty() {
        let text = format!("x{}", " ".repeat(400));
        assert_eq!(window(&text, 201..201), "");
    }
}
