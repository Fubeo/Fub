//! **Quale icona di un tema regge**: il file del set
//! ([`ThemeManifest::icons`](crate::theme::ThemeManifest::icons)), il nome di
//! ogni icona e i suoi tracciati.
//!
//! Il set è un asset JSON, `{ "<nome>": ["<d>", …] }`. Un tema non porta
//! markup: porta soltanto i `d` dei `<path>`, e la shell li mette nel costrutto
//! di tutte le altre icone (griglia 24, tratto, `currentColor`). È la stessa
//! regola con cui la shell accetta le icone che i suoi moduli registrano
//! (`registerIcon`), quindi un tema non apre una porta nuova.
//!
//! La regola ha due applicatori veri. L'host la chiede all'installazione e
//! alla lettura di un tema, e rifiuta il manifest; la shell la richiede al
//! fascio prima di costruire un `<svg>`, perché il fascio che arriva dal canale
//! resta una forma non fidata. Una fixture generata
//! (`crates/fub-abi/tests/rules_mirror.rs`) tiene uguali le due letture, e con
//! la risposta viaggiano i limiti, così la shell non li ricopia a mano.
//!
//! Restano fuori, locali a ciascun lato, la lettura del JSON e il peso in byte
//! del file intero: li fa chi ha i byte fra le mani. Restano fuori anche i nomi
//! che la shell sa disegnare: un nome che oggi nessuno disegna non rifiuta il
//! tema, perché i moduli registrano le loro icone quando si caricano.

use serde::{Deserialize, Serialize};

pub use crate::theme::{
    MAX_THEME_ICONS, MAX_THEME_ICONS_BYTES, MAX_THEME_ICON_BYTES, MAX_THEME_ICON_PATHS,
};

/// Quanto può essere lungo il nome di un'icona del tema.
pub const MAX_THEME_ICON_NAME: usize = 64;

/// Quanto può essere lungo il `<nome>` di `<nome>.json`, il file del set.
pub const MAX_THEME_ICONS_FILE_NAME: usize = 64;

/// Perché una voce del set di icone non regge: la prima cosa che non va,
/// nell'ordine nome, numero di tracciati, forma di un tracciato, peso.
///
/// Attraversa la fixture come etichetta, non come frase: la frase che una
/// persona legge è di chi la scrive (host o shell).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeIconFault {
    /// Non è un id minuscolo (`a-z`, `0-9`, `-`, senza `-` in testa) di al
    /// più [`MAX_THEME_ICON_NAME`] caratteri.
    Name,
    /// Nessun tracciato, o più di [`MAX_THEME_ICON_PATHS`].
    Paths,
    /// Un tracciato vuoto, o con un carattere che non è un comando o un numero
    /// di un tracciato SVG: niente markup, virgolette, attributi o riferimenti.
    PathData,
    /// I tracciati, insieme, superano [`MAX_THEME_ICON_BYTES`] byte.
    Bytes,
}

/// La voce regge? `None` se sì, altrimenti la prima cosa che non va.
pub fn theme_icon_fault<S: AsRef<str>>(name: &str, paths: &[S]) -> Option<ThemeIconFault> {
    if !is_icon_name(name) {
        return Some(ThemeIconFault::Name);
    }
    if paths.is_empty() || paths.len() > MAX_THEME_ICON_PATHS {
        return Some(ThemeIconFault::Paths);
    }
    if !paths.iter().all(|d| is_path_data(d.as_ref())) {
        return Some(ThemeIconFault::PathData);
    }
    let bytes: usize = paths.iter().map(|d| d.as_ref().len()).sum();
    if bytes > MAX_THEME_ICON_BYTES {
        return Some(ThemeIconFault::Bytes);
    }
    None
}

/// Il file del set regge? `<nome>.json` nella cartella del tema, con un nome
/// minuscolo di lettere e cifre ASCII, `-` o `_`, e mai `manifest`: il
/// manifest non è un asset. Minuscolo perché su un disco che non distingue le
/// maiuscole `Manifest.json` sarebbe il manifest.
pub fn theme_icons_file_holds(file: &str) -> bool {
    let Some(name) = file.strip_suffix(".json") else {
        return false;
    };
    !name.is_empty()
        && name.len() <= MAX_THEME_ICONS_FILE_NAME
        && name != "manifest"
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Un `d` di un tracciato SVG: solo i comandi, le cifre, il punto, la virgola,
/// i segni, l'esponente e gli spazi ASCII. È ciò che può stare fra le
/// virgolette di `d="…"` senza fughe.
pub fn is_path_data(d: &str) -> bool {
    !d.is_empty()
        && d.bytes().all(|b| {
            matches!(
                b,
                b'M' | b'm'
                    | b'L'
                    | b'l'
                    | b'H'
                    | b'h'
                    | b'V'
                    | b'v'
                    | b'C'
                    | b'c'
                    | b'S'
                    | b's'
                    | b'Q'
                    | b'q'
                    | b'T'
                    | b't'
                    | b'A'
                    | b'a'
                    | b'Z'
                    | b'z'
                    | b'0'
                    ..=b'9'
                        | b'e'
                        | b'E'
                        | b'.'
                        | b','
                        | b'+'
                        | b'-'
                        | b' '
                        | b'\t'
                        | b'\n'
                        | b'\r'
                        | b'\x0C'
            )
        })
}

/// Un id minuscolo: `a-z`, `0-9` e `-`, che comincia con una lettera o una
/// cifra. È la forma dei nomi che la shell registra.
fn is_icon_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    name.len() <= MAX_THEME_ICON_NAME
        && (first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_well_formed_entry_holds() {
        assert_eq!(
            theme_icon_fault("search", &["M10 17a7 7 0 1 0 0-14z"]),
            None
        );
    }

    #[test]
    fn markup_and_quotes_are_not_path_data() {
        for d in ["M0 0\"/><script>", "M0 0<", "M0 0 url(#x)", "M0\u{a0}0", ""] {
            assert_eq!(
                theme_icon_fault("search", &[d]),
                Some(ThemeIconFault::PathData),
                "{d:?}"
            );
        }
    }

    #[test]
    fn the_first_fault_wins_in_order() {
        assert_eq!(
            theme_icon_fault::<&str>("Search", &[]),
            Some(ThemeIconFault::Name)
        );
        assert_eq!(
            theme_icon_fault::<&str>("search", &[]),
            Some(ThemeIconFault::Paths)
        );
        let big = "M".repeat(MAX_THEME_ICON_BYTES + 1);
        assert_eq!(
            theme_icon_fault("search", &[big]),
            Some(ThemeIconFault::Bytes)
        );
    }

    #[test]
    fn the_set_file_is_a_lowercase_json_beside_the_manifest() {
        assert!(theme_icons_file_holds("icons.json"));
        assert!(theme_icons_file_holds("icone_2-fini.json"));
        for file in [
            "manifest.json",
            "Icons.json",
            "icons/set.json",
            "../icons.json",
            "icons.JSON",
            ".json",
            "icons",
        ] {
            assert!(!theme_icons_file_holds(file), "{file}");
        }
    }
}
