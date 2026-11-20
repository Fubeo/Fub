//! Le parole di una domanda confrontata col testo grezzo (maiuscole esatte,
//! ambito di riga, blocco o sezione), e i loro confini.
//!
//! Una parola è una sequenza di lettere, cifre e **segni combinanti**: la «é»
//! scritta come `e` + accento combinante (U+0301) è una lettera sola per chi
//! legge, e spezzarla in `e` e accento faceva cercare `caffe` dentro
//! `caffe\u{301}` con un confine `\b` che lì non c'è (l'accento per la regex è
//! un carattere di parola): la nota non si trovava.
//!
//! Il confine non è `\b` per la stessa ragione, e per una seconda: `\b` vuole
//! un carattere di parola da un lato, e attorno a un'emoji non c'è. Una frase
//! esatta che finiva con «🗺» non combaciava mai (IMP-113). Qui il confine si
//! scrive per esteso, con la stessa classe delle parole, e solo dal lato in cui
//! la frase comincia o finisce con una lettera.

use std::sync::LazyLock;

/// Un carattere di parola, nella sintassi delle regex.
const WORD: &str = r"[\p{L}\p{N}\p{M}]";
/// Ciò che sta fra due parole.
pub(super) const GAP: &str = r"[^\p{L}\p{N}\p{M}]+";
/// Il confine prima di una parola: l'inizio del testo o un non-carattere.
pub(super) const BEFORE: &str = r"(?:^|[^\p{L}\p{N}\p{M}])";
/// Il confine dopo una parola: la fine del testo o un non-carattere.
pub(super) const AFTER: &str = r"(?:$|[^\p{L}\p{N}\p{M}])";

static WORDS: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(&format!("{WORD}+")).expect("classe valida"));

/// Le parole di `text`, nell'ordine; simboli ed emoji non sono parole.
pub(super) fn words(text: &str) -> Vec<&str> {
    WORDS.find_iter(text).map(|m| m.as_str()).collect()
}

/// `true` se `c` fa parte di una parola.
pub(super) fn is_word_char(c: char) -> bool {
    let mut buf = [0u8; 4];
    let one = c.encode_utf8(&mut buf);
    WORDS.find(one).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_combining_accent_stays_inside_its_word() {
        assert_eq!(
            words("un caffe\u{301} al bar"),
            ["un", "caffe\u{301}", "al", "bar"]
        );
    }

    #[test]
    fn symbols_emoji_and_flags_are_not_words() {
        assert_eq!(words("è 🗺 👨‍👩‍👧 🇮🇹"), ["è"]);
        assert!(!is_word_char('🗺'));
        assert!(is_word_char('\u{301}'));
        assert!(is_word_char('東'));
    }

    #[test]
    fn the_boundaries_hold_around_emoji_and_combining_marks() {
        let re = regex::Regex::new(&format!("{BEFORE}caffe\u{301}{AFTER}")).unwrap();
        assert!(re.is_match("un caffe\u{301}."));
        assert!(re.is_match("caffe\u{301}"));
        assert!(!re.is_match("caffe\u{301}\u{301}x"));
        let caffe = regex::Regex::new(&format!("{BEFORE}caffe{AFTER}")).unwrap();
        assert!(
            !caffe.is_match("caffe\u{301}"),
            "l'accento è parte della parola"
        );
    }
}
