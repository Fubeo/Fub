//! **La forma normalizzata su cui si giudica l'identità di un nome**: NFC.
//!
//! Non è una regola di identità: è il *terreno* su cui le altre la decidono.
//! `Café` scritto con un code point solo e `Cafe` + accento combinante sono due
//! sequenze di byte diverse e la **stessa** parola, e il vault non sceglie fra
//! le due — un vault sincronizzato con macOS ha i nomi in NFD mentre ciò che
//! l'utente digita è NFC. Chi confronta due nomi senza passare di qui risponde
//! «no» a una domanda la cui risposta è «sì», e lo fa **nei due versi**.
//!
//! # Perché una funzione con un nome, e non `.nfc()` scritto ogni volta
//!
//! Perché il gesto scritto a mano è quello che il prossimo dimentica. La
//! decisione 0136 ha stabilito che le regole di identità di un nome devono
//! essere **più d'una** e ognuna dichiarata; questo modulo è l'altra metà di
//! quella riga: possono divergere su cosa confrontano, non su **come sono
//! scritti** i caratteri che confrontano. [`composed`] è quel «come», e chi la
//! chiama lo eredita invece di riscriverlo.
//!
//! # Le due forme, e perché servono tutte e due
//!
//! [`composed`] risponde a chi produce una **chiave** — una stringa nuova, da
//! confrontare con un'altra stringa nuova. [`cluster_end`] risponde a chi
//! produce un **offset** dentro il testo originale: lì una copia normalizzata
//! non si può usare, perché ha un'altra lunghezza in byte e uno span misurato
//! su di lei porterebbe il cursore altrove. Chi ha quel vincolo confronta un
//! grappolo per volta e avanza di grappoli, che è ciò che [`cluster_end`]
//! misura.

use unicode_normalization::char::canonical_combining_class;
use unicode_normalization::UnicodeNormalization;

/// `s` nella forma **composta** (NFC): la forma su cui ogni regola di identità
/// di un nome giudica.
pub fn composed(s: &str) -> String {
    s.nfc().collect()
}

/// Dove finisce, in byte, il **grappolo canonico** che comincia a `at`: un
/// carattere e le combinanti che lo seguono.
///
/// È l'unità più piccola che si può comporre senza cambiare ciò che la
/// circonda, e quindi l'unità più piccola su cui si può confrontare **senza
/// perdere gli offset**: `e` + `U+0301` è un grappolo solo e vale `é`, e un
/// confronto che si fermasse in mezzo direbbe che `cafe` sta dentro `café`.
///
/// `at` deve essere un confine di carattere; a fine stringa rende `at`.
pub fn cluster_end(s: &str, at: usize) -> usize {
    let mut chars = s[at..].char_indices();
    let Some((_, first)) = chars.next() else {
        return at;
    };
    let mut end = at + first.len_utf8();
    for (the, c) in chars {
        if canonical_combining_class(c) == 0 {
            break;
        }
        end = at + the + c.len_utf8();
    }
    end
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_writes_of_a_letter_accented_become_a() {
        let nfc = "Café";
        let nfd = "Cafe\u{301}";
        assert_ne!(
            nfc, nfd,
            "le due forme sono byte diversi, o non si prova nulla"
        );
        assert_eq!(composed(nfc), composed(nfd));
        assert_eq!(composed(nfd), nfc);
    }

    #[test]
    fn a_cluster_and_a_letter_with_the_its_combining() {
        // ASCII: un carattere, un grappolo.
        assert_eq!(cluster_end("abc", 0), 1);
        // `e` + accento combinante: un grappolo di tre byte.
        assert_eq!(cluster_end("e\u{301}x", 0), 3);
        // Due combinanti di fila stanno nello stesso grappolo.
        assert_eq!(cluster_end("e\u{301}\u{327}x", 0), 5);
        // La lettera precomposta è già un grappolo per conto suo.
        assert_eq!(cluster_end("éx", 0), 2);
        // A fine stringa non c'è niente da consumare.
        assert_eq!(cluster_end("ab", 2), 2);
    }
}
