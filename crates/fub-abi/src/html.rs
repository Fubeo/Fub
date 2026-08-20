//! **L'unica tabella di escape del repo, e l'unico modo di scrivere un
//! attributo.**
//!
//! Sta nel contratto e non in un provider perché chi produce HTML non è uno.
//! [`CustomRendering::Html`](crate::custom::CustomRendering::Html) è una via
//! dichiarata *qui*: un renderer registrato può restituire markup, e quel markup
//! entra nella pagina. Chi lo scrive — il provider markdown, i renderer
//! ufficiali dei blocchi, il kernel che monta i segnaposto delle parti
//! dichiarative, e domani un plugin di terzi — aveva finora una tabella per
//! ciascuno, scritta a mano.
//!
//! Le tre copie **erano già divergenti**, ed è il motivo per cui questo modulo
//! esiste invece di una nota nel doc di `CustomRendering`:
//!
//! | dove | `&` | `<` | `>` | `"` | `'` |
//! |---|---|---|---|---|---|
//! | `fub-format-markdown` · `util.rs` | sì | sì | sì | sì | sì |
//! | `fub-features` · `blocks.rs` | sì | sì | sì | sì | **no** |
//! | `fub-kernel` · `renderer.rs` | sì | sì | **no** | sì | **no** |
//!
//! E la copia meno completa stava nel file che il repo indica come l'esempio da
//! copiare: il doc di `fub-features::blocks` dice *«un plugin che volesse
//! aggiungere la propria sintassi scriverebbe esattamente questo codice»*.
//!
//! # Perché non basta una funzione di escape
//!
//! Un `escape` condiviso lascia in piedi il gesto che genera il difetto —
//! `format!(" data-x=\"{}\"", valore)` con l'escape dimenticato compila, e
//! nessuno lo vede finché il valore non contiene un delimitatore. Chi scrive un
//! attributo passa da [`attr`], che mette **lui** il nome, le virgolette e
//! l'escape: dimenticarlo non è più una svista possibile, perché non c'è più
//! niente da ricordarsi. La funzione [`escape`] resta pubblica per il contenuto
//! testuale, che virgolette non ne ha.
//!
//! # Una tabella sola per il testo e per l'attributo
//!
//! `'` non serve dentro un attributo delimitato da `"`, e `"` non serve nel
//! testo. Distinguere i due casi vuol dire due tabelle e un chiamante che deve
//! sceglierne una — cioè esattamente la scelta da cui nasce la divergenza qui
//! sopra. Escapare i cinque caratteri sempre non perde niente (`&#39;` in un
//! nodo di testo *è* un apice per qualunque parser HTML) e toglie di mezzo la
//! domanda: il giorno che qualcuno emette un attributo fra apici singoli — che
//! è HTML valido — il valore è già al sicuro.

/// I cinque caratteri, e la loro entità.
///
/// È l'elenco, non un `match`, perché il banco che lo fissa deve poterlo
/// **contare**: un carattere tolto si vede, un ramo tolto da un `match` no.
const TABLE: &[(char, &str)] = &[
    ('&', "&amp;"),
    ('<', "&lt;"),
    ('>', "&gt;"),
    ('"', "&quot;"),
    ('\'', "&#39;"),
];

/// Il testo, reso inerte: i cinque caratteri che HTML interpreta diventano le
/// loro entità.
///
/// Serve per il **contenuto** di un elemento. Per un attributo non si usa
/// direttamente — si usa [`attr`], che le virgolette le mette da sé.
pub fn escape(s: &str) -> String {
    // Niente da escapare? Il giro carattere per carattere non serve. La prova
    // nasce dalla TABELLA stessa, così non può divergere da ciò che il ciclo
    // escaperebbe.
    if !TABLE.iter().any(|(k, _)| s.contains(*k)) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match TABLE.iter().find(|(k, _)| *k == c) {
            Some((_, entity)) => out.push_str(entity),
            None => out.push(c),
        }
    }
    out
}

/// Un attributo intero: lo spazio davanti, il nome, le virgolette e il valore
/// già escapato — ` nome="valore"`.
///
/// Lo spazio iniziale c'è perché un attributo si concatena sempre a qualcosa che
/// lo precede (il nome del tag, o l'attributo prima), e lasciarlo al chiamante
/// vuol dire un tag malformato il giorno che se lo dimentica.
///
/// **Il nome non è escapato, ed è deliberato**: un nome di attributo non è un
/// dato: è scritto nel sorgente da chi emette il markup. Se un giorno arrivasse
/// da fuori, il posto in cui rifiutarlo sarebbe la convalida di chi lo riceve,
/// non un escape che lo trasformerebbe in un nome diverso e altrettanto
/// arbitrario.
pub fn attr(name: &str, value: &str) -> String {
    format!(" {name}=\"{}\"", escape(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La tabella, fissata carattere per carattere.
    ///
    /// Il conto in coda è la metà che serve: senza, questo banco resterebbe
    /// verde se qualcuno *aggiungesse* una riga sbagliata alla tabella, e
    /// resterebbe verde per costruzione se la tabella si accorciasse — perché
    /// l'assert qui sotto guarda una stringa sola.
    #[test]
    fn the_five_characters_and_no_others() {
        assert_eq!(TABLE.len(), 5);
        assert_eq!(escape("a<b>&\"'"), "a&lt;b&gt;&amp;&quot;&#39;");
        // Ciò che non è nella tabella passa intero, accenti e CJK compresi.
        assert_eq!(escape("Caffè — 漢字"), "Caffè — 漢字");
        assert_eq!(escape(""), "");
    }

    /// Un attributo si scrive tutto o niente: chi chiama non ha in mano né le
    /// virgolette né l'escape, quindi non può scriverne metà.
    #[test]
    fn an_attribute_brings_its_own_quotes_and_escape() {
        assert_eq!(attr("data-x", "a\"b"), " data-x=\"a&quot;b\"");
        // L'apice: il carattere che due delle tre copie divergenti si
        // lasciavano indietro.
        assert_eq!(attr("title", "l'ora"), " title=\"l&#39;ora\"");
        assert_eq!(attr("id", ""), " id=\"\"");
    }
}
