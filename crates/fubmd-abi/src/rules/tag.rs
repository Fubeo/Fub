//! I tag: la forma canonica del nome, e la gerarchia.
//!
//! La forma canonica è [`canonical_tag`](crate::model::canonical_tag) e sta nel
//! modello da prima (decisione 0003), dove la chiedono anche i parser; qui c'è
//! l'altra metà, che è la sola cosa che un tag "sa fare" oltre a chiamarsi in un
//! modo: contenerne altri.

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

#[cfg(test)]
mod tests {
    use super::*;

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
