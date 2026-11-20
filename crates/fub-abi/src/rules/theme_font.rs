//! **Quale voce di `fonts` regge**: la famiglia, il file, il peso e lo stile
//! di un carattere che un tema porta ([`ThemeFont`](crate::theme::ThemeFont)).
//!
//! La regola ha due applicatori veri. L'host la chiede all'installazione e alla
//! lettura di un tema, e rifiuta il manifest; la shell la richiede al fascio
//! prima di scrivere una regola `@font-face`, perché il fascio che arriva dal
//! canale resta una forma non fidata. Le due letture devono coincidere, e una
//! fixture generata (`crates/fub-abi/tests/rules_mirror.rs`) le tiene uguali:
//! la risposta di qui, caso per caso, è quella che la gemella TypeScript deve
//! dare. Con la risposta viaggiano anche i limiti e gli elenchi di nomi, così
//! la shell non li ricopia a mano.
//!
//! Restano fuori, locali a ciascun lato, i controlli sui byte del file (la
//! firma `wOF2`, il peso in byte di ogni file e del totale): li fa chi ha i
//! byte fra le mani.

use serde::{Deserialize, Serialize};

pub use crate::theme::{
    MAX_THEME_FONTS, MAX_THEME_FONT_BYTES, MAX_THEME_FONT_FAMILY, MAX_THEME_FONT_TOTAL_BYTES,
};

/// Quanto può essere lungo il `<nome>` di `fonts/<nome>.woff2`.
pub const MAX_THEME_FONT_FILE_NAME: usize = 64;

/// Il peso più leggero e quello più pesante che una voce può dichiarare.
pub const THEME_FONT_WEIGHTS: (u16, u16) = (100, 900);

/// Le famiglie dei caratteri di serie (`apps/client/src/theme/scrittoio/fonts.css`,
/// canale `caratteri`). Un tema non può dichiarare una famiglia con uno di
/// questi nomi: la sua regola `@font-face` si mescolerebbe a quella di serie, e
/// ciò che la persona vede dipenderebbe da quale delle due il motore sceglie.
/// La shell tiene l'elenco allineato al foglio con un test.
pub const SERIES_FONT_FAMILIES: &[&str] = &[
    "Newsreader Variable",
    "Hanken Grotesk Variable",
    "IBM Plex Mono",
    "Inter Variable",
    "Literata Variable",
    "JetBrains Mono Variable",
];

/// I nomi che in `font-family` non sono una famiglia ma una parola chiave del
/// CSS: famiglie generiche e valori globali.
pub const RESERVED_FONT_FAMILIES: &[&str] = &[
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "math",
    "emoji",
    "fangsong",
    "inherit",
    "initial",
    "unset",
    "revert",
    "revert-layer",
    "default",
];

/// Perché una voce di `fonts` non regge: la prima cosa che non va, nell'ordine
/// famiglia, file, peso, stile.
///
/// Attraversa la fixture come etichetta, non come frase: la frase che una
/// persona legge è di chi la scrive (host o shell).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeFontFault {
    /// Vuota, troppo lunga, o con un carattere fuori da lettere e cifre ASCII,
    /// `-` e spazi singoli fra le parole.
    Family,
    /// Il nome di una famiglia di serie, in qualunque maiuscolo.
    SeriesFamily,
    /// Una parola chiave del CSS, in qualunque maiuscolo.
    ReservedFamily,
    /// Non è `fonts/<nome>.woff2` con un nome di lettere e cifre ASCII, `-` o
    /// `_`: un URL, un path che esce, un altro formato.
    File,
    /// Non è un intero fra 100 e 900.
    Weight,
    /// Né `normal` né `italic`.
    Style,
}

/// La voce regge? `None` se sì, altrimenti la prima cosa che non va.
///
/// Il peso arriva come `f64` e lo stile come testo perché la shell li legge da
/// un JSON non fidato: la regola risponde anche per un `400.5` o un `oblique`,
/// che l'host non vede mai (serde li rifiuta prima).
pub fn theme_font_fault(
    family: &str,
    file: &str,
    weight: f64,
    style: &str,
) -> Option<ThemeFontFault> {
    if !is_font_family(family) {
        return Some(ThemeFontFault::Family);
    }
    if SERIES_FONT_FAMILIES
        .iter()
        .any(|series| series.eq_ignore_ascii_case(family))
    {
        return Some(ThemeFontFault::SeriesFamily);
    }
    if RESERVED_FONT_FAMILIES
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(family))
    {
        return Some(ThemeFontFault::ReservedFamily);
    }
    if !is_font_file(file) {
        return Some(ThemeFontFault::File);
    }
    let (lightest, heaviest) = THEME_FONT_WEIGHTS;
    if weight.fract() != 0.0 || !(f64::from(lightest)..=f64::from(heaviest)).contains(&weight) {
        return Some(ThemeFontFault::Weight);
    }
    if style != "normal" && style != "italic" {
        return Some(ThemeFontFault::Style);
    }
    None
}

/// Una famiglia che la shell può scrivere fra virgolette senza fughe: lettere
/// e cifre ASCII, `-` e spazi singoli fra le parole.
fn is_font_family(family: &str) -> bool {
    !family.is_empty()
        && family.len() <= MAX_THEME_FONT_FAMILY
        && !family.starts_with(' ')
        && !family.ends_with(' ')
        && !family.contains("  ")
        && family
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '-')
}

/// `fonts/<nome>.woff2`, con un nome che non esce dalla cartella.
fn is_font_file(file: &str) -> bool {
    let Some(name) = file
        .strip_prefix("fonts/")
        .and_then(|rest| rest.strip_suffix(".woff2"))
    else {
        return false;
    };
    !name.is_empty()
        && name.len() <= MAX_THEME_FONT_FILE_NAME
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_well_formed_entry_holds() {
        assert_eq!(
            theme_font_fault("Carta Serif", "fonts/carta.woff2", 400.0, "normal"),
            None
        );
    }

    #[test]
    fn the_first_fault_wins_in_order() {
        assert_eq!(
            theme_font_fault("inter variable", "https://x", 1.0, "x"),
            Some(ThemeFontFault::SeriesFamily)
        );
        assert_eq!(
            theme_font_fault("Carta", "fonts/a.ttf", 1.0, "x"),
            Some(ThemeFontFault::File)
        );
        assert_eq!(
            theme_font_fault("Carta", "fonts/a.woff2", 400.5, "x"),
            Some(ThemeFontFault::Weight)
        );
        assert_eq!(
            theme_font_fault("Carta", "fonts/a.woff2", 400.0, "oblique"),
            Some(ThemeFontFault::Style)
        );
    }
}
