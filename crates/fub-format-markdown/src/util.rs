//! Utility: la misura dei delimitatori ripetuti.

// Lo slug degli heading NON sta più qui: è `fub_abi::model::heading_slug`.
// Era una funzione privata di questo provider, e la regola che genera un
// indirizzo (`[[Nota#Titolo]]`) deve valere per chiunque lo risolva — due
// provider con due slugify diversi danno due id allo stesso titolo.

// E l'escape HTML non sta più qui, per la stessa ragione portata un piano più
// su: era `escape_html` + `escape_attr` di questo provider, ed era la più
// completa di **tre** tabelle scritte a mano nel repo. Chi produce markup non è
// solo il provider — `CustomRendering::Html` è una via del contratto — quindi
// la tabella è del contratto: `fub_abi::html`.

/// La fila più lunga di `c` dentro `s`.
///
/// La chiedono i due posti che devono **recintare** del testo che potrebbe
/// contenere il recinto: `serialize`, per un code block e per il codice inline,
/// e `transfer`, per il frontmatter di una nota che finisce dentro un documento
/// unico. Sta qui e non in uno dei due perché il secondo non deve avere ragione
/// di nominare il primo: `serialize_non_riscrive.rs` conta chi nomina
/// `serialize` dal codice di produzione, e aveva ragione a fermarsi — prendere
/// una funzione da lì per riusarla è il primo centimetro della strada che quel
/// presidio esiste per chiudere.
pub fn longest_run(s: &str, c: char) -> usize {
    let mut max = 0;
    let mut current = 0;
    for ch in s.chars() {
        if ch == c {
            current += 1;
            max = max.max(current);
        } else {
            current = 0;
        }
    }
    max
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn longest_run_is_zero_when_input_is_empty() {
        assert_eq!(longest_run("", '`'), 0);
        assert_eq!(longest_run("a`b``c```d", '`'), 3);
        assert_eq!(longest_run("```", '`'), 3);
    }
}
