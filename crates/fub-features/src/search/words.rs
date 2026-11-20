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
//!
//! Lettere e cifre sono le classi `\p{L}` e `\p{N}` della libreria delle regex
//! **più** ciò che `char::is_alphanumeric` accetta, la funzione con cui il
//! tokenizer dell'indice spezza il testo. Le due cose differiscono in due punti:
//! certi simboli sono alfabetici (le lettere cerchiate come «Ⓐ»), e la libreria
//! standard può conoscere una versione di Unicode più nuova di `regex`. Se qui
//! un carattere fosse un confine e nell'indice no, «Ⓐfoo» darebbe `foo` alle
//! maiuscole esatte e non alla ricerca normale, e i candidati che l'indice dà
//! alle maiuscole esatte non sarebbero più tutti quelli giusti (vedi `exact`).
//! Che ogni carattere fuori dalle parole non sia alfanumerico lo prova un test.

use std::sync::LazyLock;

/// Lettere, cifre e segni combinanti per `regex`.
const BASE: &str = r"\p{L}\p{N}\p{M}";

/// L'interno della classe delle parole: [`BASE`], più i caratteri che per la
/// libreria standard sono alfanumerici e per `regex` no, scritti per
/// intervalli. Sono pochi, e la classe resta quella di prima per costo: una
/// classe scritta tutta per intervalli costava il doppio a ogni compilazione.
static CLASS: LazyLock<String> = LazyLock::new(|| {
    use regex_syntax::hir::{Class, ClassUnicode, ClassUnicodeRange, HirKind};
    let base = regex_syntax::parse(&format!("[{BASE}]")).expect("classe valida");
    let HirKind::Class(Class::Unicode(base)) = base.kind() else {
        unreachable!("una classe Unicode");
    };
    let mut ranges = Vec::new();
    let mut run: Option<(char, char)> = None;
    for c in (0..=char::MAX as u32).filter_map(char::from_u32) {
        run = match (run, c.is_alphanumeric()) {
            (Some((from, _)), true) => Some((from, c)),
            (None, true) => Some((c, c)),
            (Some((from, to)), false) => {
                ranges.push(ClassUnicodeRange::new(from, to));
                None
            }
            (None, false) => None,
        };
    }
    if let Some((from, to)) = run {
        ranges.push(ClassUnicodeRange::new(from, to));
    }
    let mut extra = ClassUnicode::new(ranges);
    extra.difference(base);
    let mut class = String::from(BASE);
    for range in extra.ranges() {
        let (from, to) = (u32::from(range.start()), u32::from(range.end()));
        class.push_str(&format!(r"\x{{{from:X}}}-\x{{{to:X}}}"));
    }
    class
});

/// Ciò che sta fra due parole.
pub(super) static GAP: LazyLock<String> = LazyLock::new(|| format!("[^{}]+", *CLASS));
/// Il confine prima di una parola: l'inizio del testo o un non-carattere.
pub(super) static BEFORE: LazyLock<String> = LazyLock::new(|| format!("(?:^|[^{}])", *CLASS));
/// Il confine dopo una parola: la fine del testo o un non-carattere.
pub(super) static AFTER: LazyLock<String> = LazyLock::new(|| format!("(?:$|[^{}])", *CLASS));

static WORDS: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(&format!("[{}]+", *CLASS)).expect("classe valida"));

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

    /// Il patto con il tokenizer dell'indice: dove qui una parola finisce,
    /// finisce anche il token, anche coi caratteri che `regex` non conosce
    /// ancora e la libreria standard sì.
    #[test]
    fn whatever_is_not_a_word_character_splits_the_index_tokens_too() {
        let glued: Vec<char> = (0..=char::MAX as u32)
            .filter_map(char::from_u32)
            .filter(|c| c.is_alphanumeric() && !is_word_char(*c))
            .collect();
        assert!(
            glued.is_empty(),
            "alfanumerici fuori dalle parole: {glued:?}"
        );
        assert!(is_word_char('Ⓐ') && is_word_char('ⓐ'));
        assert_eq!(words("xⒶfoo bar"), ["xⒶfoo", "bar"]);
    }

    #[test]
    fn the_boundaries_hold_around_emoji_and_combining_marks() {
        let re = regex::Regex::new(&format!("{}caffe\u{301}{}", *BEFORE, *AFTER)).unwrap();
        assert!(re.is_match("un caffe\u{301}."));
        assert!(re.is_match("caffe\u{301}"));
        assert!(!re.is_match("caffe\u{301}\u{301}x"));
        let caffe = regex::Regex::new(&format!("{}caffe{}", *BEFORE, *AFTER)).unwrap();
        assert!(
            !caffe.is_match("caffe\u{301}"),
            "l'accento è parte della parola"
        );
    }
}
