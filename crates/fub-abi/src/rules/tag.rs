//! I tag: la forma canonica del nome, la gerarchia, e **dove comincia e finisce
//! un `#tag` in un testo**.
//!
//! La forma canonica è [`canonical_tag`](crate::model::canonical_tag) e sta nel
//! modello da prima (decisione 0003), dove la chiedono anche i parser; qui c'è
//! l'altra metà, che è la sola cosa che un tag "sa fare" oltre a chiamarsi in un
//! modo: contenerne altri.
//!
//! # Perché il riconoscimento è salito qui (§4.4)
//!
//! [`scan_tags`] stava in `fub_sdk::scan`, cioè nel **toolkit di chi parsa**, e
//! l'argomento per cui non doveva starci era già scritto tre righe più giù, nel
//! doc di `parse_wikilink_inner`: *la grammatica di `Page#Heading^block|Alias`
//! descrive i campi di `LinkTarget::Wiki`, quindi è una regola di ciò che il
//! contratto dichiara — come `canonical_tag` — e non del toolkit di chi lo usa.*
//! Vale identico per il `#tag`, che descrive i campi di [`Tag`]: finché la
//! regola stava nell'SDK, due provider potevano legittimamente rispondere due
//! cose diverse sulla stessa riga, e il vault avrebbe avuto due idee di quali
//! tag contiene — la stessa specie di difetto della 0107 e della riparazione
//! `568874c`, un gradino più a monte.
//!
//! E c'è il motivo che l'ha resa urgente: la §4.4. Una superficie di scrittura
//! non ha il parser e riconosce i tag per conto suo mentre si scrive; se la
//! regola non è **una**, ciò che si vede scrivendo e ciò che viene indicizzato
//! dicono due cose diverse sullo stesso testo. Adesso è una, e la gemella
//! TypeScript è legata a questa dalla fixture di `rules_mirror.rs`.

use crate::model::{Span, Tag};

/// `progetto/casa` sta sotto `progetto`?
///
/// La `/` è il separatore di gerarchia, e la regola è **prefisso più
/// separatore**: `progetto` prende `progetto/casa` e non prende `progettone`.
/// Entrambe le stringhe sono attese in forma canonica
/// ([`canonical_tag`](crate::model::canonical_tag)) — la chiedono in due, il
/// predicato del linguaggio (`Tag { descendants }`) e il conteggio, e chiedendo
/// la stessa cosa devono ottenere la stessa risposta.
///
/// Un tag non sta sotto sé stesso: `is_sub_tag("a", "a")` è falso. Chi vuole
/// «`a` e i suoi discendenti» scrive `key == ancestor || is_sub_tag(key,
/// ancestor)`, che è la forma in cui la domanda si pone davvero.
pub fn is_sub_tag(key: &str, ancestor: &str) -> bool {
    key.strip_prefix(ancestor)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// Estrae i `#tag` da un frammento di **testo semplice** (il chiamante deve già
/// aver escluso code span, code block e frontmatter).
///
/// Regole in stile Obsidian: un tag è `#` seguito da lettere/cifre/`_`/`-`/`/`,
/// deve contenere almeno un carattere non numerico, e il `#` non deve seguire
/// un carattere alfanumerico (per non catturare `foo#bar`). Gli offset degli
/// [`Span`] sono relativi all'inizio di `text` e sono **byte**, come ogni span
/// del modello.
///
/// Le tre condizioni sono tre decisioni, e conviene dirle nella forma in cui
/// qualcuno le riscriverebbe sbagliate:
///
/// - **prima del `#`**: il divieto è «carattere alfanumerico», non «non è uno
///   spazio». `a.#tag`, `(#tag`, `"#tag` e `_#tag` sono tag; `a#b` no. Una
///   regola che pretendesse spazio o inizio riga sarebbe più stretta, e ne
///   perderebbe quattro casi su cinque scritti da un umano;
/// - **dentro il nome**: `char::is_alphanumeric()` più `_ - /`. I **segni
///   combinanti** (`\p{M}`) non sono alfanumerici, quindi un `é` scritto
///   decomposto (NFD) chiude il tag sull'accento: è un fatto, non un'opinione, e
///   dev'essere lo stesso fatto sulle due superfici o `#Café` diventa due tag
///   a seconda di chi guarda;
/// - **tutto cifre non è un tag**: e sono le cifre **ASCII**, non `\p{N}`.
///   `#123` non è un tag, `#١٢٣` lo è.
pub fn scan_tags(text: &str) -> Vec<Tag> {
    let bytes = text.as_bytes();
    let mut tags = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'#' {
            i += 1;
            continue;
        }
        // Il '#' non deve seguire un carattere alfanumerico.
        if i > 0 {
            let prev = text[..i].chars().next_back();
            if prev.map(|c| c.is_alphanumeric()).unwrap_or(false) {
                i += 1;
                continue;
            }
        }
        // Consuma i caratteri del nome del tag.
        let name_start = i + 1;
        let mut j = name_start;
        while j < text.len() {
            let c = text[j..].chars().next().unwrap();
            if is_tag_char(c) {
                j += c.len_utf8();
            } else {
                break;
            }
        }
        let name = &text[name_start..j];
        if !name.is_empty() && !name.chars().all(|c| c.is_ascii_digit()) {
            tags.push(Tag {
                name: name.to_string(),
                span: Span::new(i, j),
            });
        }
        i = j.max(i + 1);
    }
    tags
}

fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '/')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(text: &str) -> Vec<String> {
        scan_tags(text).into_iter().map(|t| t.name).collect()
    }

    #[test]
    fn extracts_simple_and_nested_tags() {
        assert_eq!(
            names("ciao #progetto e #area/lavoro"),
            vec!["progetto", "area/lavoro"]
        );
    }

    #[test]
    fn ignores_numeric_and_mid_word_hash() {
        assert_eq!(names("issue #123 e colore #fff ok"), vec!["fff"]);
        assert_eq!(names("a#b non e' un tag"), Vec::<String>::new());
    }

    #[test]
    fn tag_span_includes_hash() {
        let tags = scan_tags("x #foo");
        assert_eq!(tags[0].span, Span::new(2, 6));
    }

    /// I tre confini che una seconda implementazione sbaglia per primi, e che
    /// la §4.4 ha misurato divergenti fra il modello e la live preview.
    #[test]
    fn i_tre_confini_che_una_seconda_implementazione_sbaglia() {
        // 1. Prima del `#`: alfanumerico, non «spazio».
        assert_eq!(names("vedi.#tag"), vec!["tag"]);
        assert_eq!(names("_#tag"), vec!["tag"]);
        assert_eq!(names("a#b"), Vec::<String>::new());
        // 2. Un segno combinante non è alfanumerico: il tag finisce lì.
        assert_eq!(names("#Cafe\u{301}"), vec!["Cafe"]);
        assert_eq!(names("#Caf\u{e9}"), vec!["Café"]);
        // 3. «Tutto cifre» sono le cifre ASCII.
        assert_eq!(names("#123"), Vec::<String>::new());
        assert_eq!(names("#\u{661}\u{662}\u{663}"), vec!["١٢٣"]);
    }

    #[test]
    fn the_separator_is_what_makes_a_child() {
        assert!(is_sub_tag("progetto/casa", "progetto"));
        assert!(is_sub_tag("progetto/casa/cucina", "progetto"));
        // Un prefisso di caratteri non è un prefisso di gerarchia.
        assert!(!is_sub_tag("progettone", "progetto"));
        // Nessuno è discendente di sé stesso.
        assert!(!is_sub_tag("progetto", "progetto"));
    }
}
