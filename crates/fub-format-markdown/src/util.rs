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
pub fn fila_massima(s: &str, c: char) -> usize {
    let mut max = 0;
    let mut corrente = 0;
    for ch in s.chars() {
        if ch == c {
            corrente += 1;
            max = max.max(corrente);
        } else {
            corrente = 0;
        }
    }
    max
}

/// Il testo riportato a **come si legge**: `\*` → `*`.
///
/// La regola è quella di CommonMark: una barra rovescia escapa un segno di
/// punteggiatura ASCII, e davanti a qualunque altra cosa è un carattere. La
/// applica in linea anche il decoder dei segmenti di `parse`
/// (`decodifica_segmento`), che però deve consumare i byte mentre cammina e
/// non può riusarla; qui la chiede `serialize`, dentro un `[[…]]`: fra la
/// barra verticale e le due parentesi chiuse **non c'è escape**, l'alias è
/// testo nudo fino a `]]`. Scriverlo escapato non lo proteggeva da niente e
/// cambiava ciò che si legge a schermo — e, siccome l'alias si scrive solo
/// quando dice qualcosa di diverso dal bersaglio, faceva anche nascere un `|`
/// dove non ce n'era: `[[#Sezione]]` usciva `[[#Sezione|\#Sezione]]`.
pub fn disescapa(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            let mut avanti = chars.clone();
            if let Some(n) = avanti.next().filter(|n| n.is_ascii_punctuation()) {
                out.push(n);
                chars = avanti;
                continue;
            }
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_fila_si_misura_anche_quando_e_zero() {
        assert_eq!(fila_massima("", '`'), 0);
        assert_eq!(fila_massima("a`b``c```d", '`'), 3);
        assert_eq!(fila_massima("```", '`'), 3);
    }
}
