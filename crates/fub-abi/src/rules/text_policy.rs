//! Cosa dicono di sé i byte di un file — e cosa non si fa loro.
//!
//! Questo modulo **rileva e dichiara**. Non converte niente, e la differenza non
//! è di stile: il catalogo (§2.4 di `docs/FEATURES.md`) promette che «un file che
//! Fub non ha modificato resta identico byte per byte; uno che ha modificato
//! differisce solo dove la modifica è avvenuta», e ne fa una condizione di
//! prodotto — *«un `git diff` che mostra righe che l'utente non ha scritto è un
//! difetto, non un dettaglio di formattazione»*. Un modulo che normalizzasse i
//! terminatori di riga o aggiungesse un BOM romperebbe quella promessa nel punto
//! esatto in cui esiste per presidiarla.
//!
//! Quindi qui non c'è nessuna funzione che restituisca un `String` diverso da
//! quello che le è stato dato. Ci sono tre domande e le loro risposte:
//!
//! 1. **Questi byte sono testo?** — [`decode`], che non indovina un encoding.
//! 2. **Che forma ha questo testo?** — [`bom_len`], [`Newline::of`].
//! 3. **Come si scrive una riga nuova dentro questo file?** — [`line_break`],
//!    che è l'unica domanda a cui serve una risposta *operativa*, ed è la
//!    ragione per cui il rilevamento ha un cliente: chi genera una riga con `\n`
//!    dentro un file CRLF non ha convertito niente e ha comunque prodotto un
//!    file misto, cioè un diff più grande della modifica.
//!
//! # Perché non si indovina l'encoding
//!
//! «Rilevamento encoding» si può leggere in due modi. Il primo è annusare i byte
//! e scommettere su un charset: è ciò che fa un browser, e sbagliando **corrompe
//! in silenzio** — un file Latin-1 letto come UTF-8 fallisce, uno UTF-8 letto
//! come Latin-1 riesce e produce mojibake che poi si riscrive sul disco. Il
//! secondo è dire con certezza se i byte sono UTF-8, e dove smettono di esserlo.
//!
//! Fub fa il secondo. Un file che non è UTF-8 non è un documento da convertire:
//! è un file di cui va detto **quale byte** non torna, perché quella è
//! l'informazione con cui una persona lo ripara. La conversione, se un giorno
//! servirà, è un `ImportProvider` — cioè qualcosa che l'utente chiede, che
//! produce un file nuovo e non riscrive quello vecchio.
//!
//! # Il BOM si salta, non si toglie
//!
//! Il catalogo dice «BOM preservato se c'era, mai aggiunto se non c'era». Chi
//! parsa non lo vuole in mezzo al testo; chi scrive non lo deve perdere. Le due
//! cose stanno insieme perché [`strip_bom`] restituisce una **vista** e
//! [`bom_len`] dice di quanto quella vista è traslata rispetto al file: gli
//! offset restano quelli del file, che è ciò che la sorgente di uno
//! [`Span`](crate::model::Span) è per definizione.

/// Il BOM UTF-8 (`EF BB BF`) come carattere: `U+FEFF`.
///
/// In UTF-8 non serve a dichiarare un ordine di byte — non ce n'è uno da
/// dichiarare — e nel testo è `ZERO WIDTH NO-BREAK SPACE`: invisibile, larghezza
/// zero, e comunque un carattere. È per questo che va saltato invece di essere
/// letto come contenuto, e conservato invece di essere buttato.
pub const BOM: char = '\u{feff}';

/// Quanti byte di BOM ci sono in testa a `source`: `3` oppure `0`.
///
/// È anche di quanto sono traslate le coordinate di chi parsa
/// [`strip_bom(source)`](strip_bom) rispetto a quelle del file.
pub fn bom_len(source: &str) -> usize {
    if source.starts_with(BOM) {
        BOM.len_utf8()
    } else {
        0
    }
}

/// `source` senza il BOM iniziale: una **vista**, non una modifica.
///
/// Chi la usa deve ricordarsi che ogni offset calcolato su di lei va sommato a
/// [`bom_len`] per tornare nelle coordinate del file. È l'unica traslazione del
/// sistema, e sta scritta qui perché sia una e non una per chiamante.
pub fn strip_bom(source: &str) -> &str {
    &source[bom_len(source)..]
}

/// Con che terminatore va a capo un file.
///
/// Non è una preferenza da applicare: è un'osservazione da conservare. Un vault
/// vive su tre sistemi operativi e spesso sotto controllo di versione, e i file
/// che ci sono dentro li ha scritti chiunque — normalizzarli d'ufficio sposta
/// ogni riga di ogni file toccato.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum Newline {
    /// `\n`. Anche il file che non va a capo affatto: vedi [`Newline::of`].
    Lf,
    /// `\r\n`.
    Crlf,
    /// `\r` da solo — Mac prima di OS X. Raro, e comunque non da riscrivere.
    Cr,
    /// Più di uno. Non è un file da riparare: è un file da non peggiorare.
    Mixed,
}

impl Newline {
    /// I terminatori che `source` usa davvero.
    ///
    /// Un file **senza nessun terminatore** — una riga sola, senza newline
    /// finale — risponde [`Lf`](Newline::Lf), e non perché lo si sia misurato:
    /// perché la domanda «come va a capo un file che non va a capo» non ha una
    /// risposta osservabile, e fra le tre possibili `Lf` è quella che non
    /// sorprende nessuno. La distinzione conta solo per chi **genera**, e chi
    /// genera passa da [`line_break`], dove la scelta è dichiarata.
    pub fn of(source: &str) -> Newline {
        let (crlf, lf, cr) = counts(source);
        match (crlf > 0, lf > 0, cr > 0) {
            (true, false, false) => Newline::Crlf,
            (false, false, true) => Newline::Cr,
            // Nessun terminatore, o solo `\n`: in entrambi i casi `Lf`.
            (false, _, false) => Newline::Lf,
            _ => Newline::Mixed,
        }
    }

    /// I byte di questo terminatore. [`Mixed`](Newline::Mixed) non ne ha uno, e
    /// chi deve scrivere una riga non chiede a lui ma a [`line_break`].
    pub fn as_str(self) -> Option<&'static str> {
        match self {
            Newline::Lf => Some("\n"),
            Newline::Crlf => Some("\r\n"),
            Newline::Cr => Some("\r"),
            Newline::Mixed => None,
        }
    }
}

/// Il terminatore con cui si scrive una riga **nuova** dentro `source`: il più
/// frequente, e `"\n"` se non ce n'è nessuno.
///
/// È la sola funzione operativa del modulo, e la sola ragione per cui il
/// rilevamento serve a qualcosa. Un template che inserisce `\n` in un file CRLF
/// non ha convertito niente — ha aggiunto una riga con un terminatore diverso
/// dalle altre, e il file è diventato misto: il prossimo strumento che lo
/// normalizza (un editor, un hook di git) riscriverà tutte le righe, e il diff
/// che l'utente vedrà non sarà la modifica che ha chiesto.
///
/// Su un file già misto risponde il terminatore che ci sta più volte: non lo
/// ripara, sceglie di non peggiorarlo. A pari conteggio vince `\r\n`, perché su
/// un file misto è quello che un'origine Windows spiega e `\n` no.
pub fn line_break(source: &str) -> &'static str {
    let (crlf, lf, cr) = counts(source);
    if crlf == 0 && lf == 0 && cr == 0 {
        return "\n";
    }
    if crlf >= lf && crlf >= cr {
        "\r\n"
    } else if lf >= cr {
        "\n"
    } else {
        "\r"
    }
}

/// `at` cade **in mezzo** a un `\r\n`?
///
/// È il confine che [`str::is_char_boundary`] non vede: `\r` e `\n` sono due
/// caratteri ASCII, quindi l'offset fra loro è un confine di carattere
/// perfettamente valido — e un edit che ci finisce sopra taglia in due un
/// terminatore di riga, lasciando dietro un `\r` orfano o un `\n` nudo dove
/// prima c'era una coppia. Non produce un documento illeggibile come farebbe
/// tagliare un carattere multibyte: produce un file **valido e diverso da quello
/// che chi ha chiesto la modifica credeva di modificare**, con una riga cambiata
/// che nessuno aveva nominato.
///
/// Un `\r\n` è un terminatore solo, e i due byte non si separano più di quanto
/// si separino i due byte di una `à`.
pub fn splits_newline(source: &str, at: usize) -> bool {
    let bytes = source.as_bytes();
    at > 0 && at < bytes.len() && bytes[at - 1] == b'\r' && bytes[at] == b'\n'
}

/// Il testo di un file, o l'offset del **primo byte che non è UTF-8**.
///
/// L'offset è l'unica cosa utile che si possa dire di un file che non si legge:
/// dice dove guardare. `std::fs::read_to_string` risponde «stream did not
/// contain valid UTF-8», che è la stessa informazione meno il dove.
pub fn decode(bytes: &[u8]) -> Result<&str, usize> {
    std::str::from_utf8(bytes).map_err(|e| e.valid_up_to())
}

/// `(\r\n, \n da solo, \r da solo)`. Un `\n` preceduto da `\r` conta per la
/// coppia e non per sé: è il conteggio che rende `Crlf` e `Mixed` distinguibili.
fn counts(source: &str) -> (usize, usize, usize) {
    let bytes = source.as_bytes();
    let mut crlf = 0;
    let mut lf = 0;
    let mut cr = 0;
    for (i, b) in bytes.iter().enumerate() {
        match b {
            b'\n' if i > 0 && bytes[i - 1] == b'\r' => crlf += 1,
            b'\n' => lf += 1,
            b'\r' if bytes.get(i + 1) != Some(&b'\n') => cr += 1,
            _ => {}
        }
    }
    (crlf, lf, cr)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn il_bom_si_misura_e_si_salta_senza_toccare_il_sorgente() {
        let con = "\u{feff}# Titolo\n";
        let senza = "# Titolo\n";
        assert_eq!(bom_len(con), 3);
        assert_eq!(bom_len(senza), 0);
        assert_eq!(strip_bom(con), senza);
        assert_eq!(strip_bom(senza), senza);
        // La vista è traslata di `bom_len`, e il sorgente è intatto: è
        // l'invariante su cui poggiano gli span del parser.
        assert_eq!(&con[bom_len(con)..], strip_bom(con));
        assert_eq!(con.len(), senza.len() + 3);
    }

    #[test]
    fn un_bom_a_meta_file_non_e_un_bom() {
        // `U+FEFF` è un carattere come un altro se non sta in testa: toglierlo
        // sarebbe modificare il contenuto.
        let s = "testo\u{feff}altro";
        assert_eq!(bom_len(s), 0);
        assert_eq!(strip_bom(s), s);
    }

    #[test]
    fn i_terminatori_si_riconoscono_anche_quando_sono_misti() {
        assert_eq!(Newline::of("a\nb\n"), Newline::Lf);
        assert_eq!(Newline::of("a\r\nb\r\n"), Newline::Crlf);
        assert_eq!(Newline::of("a\rb\r"), Newline::Cr);
        assert_eq!(Newline::of("a\r\nb\nc\n"), Newline::Mixed);
        assert_eq!(Newline::of("a\rb\nc"), Newline::Mixed);
        // Nessun terminatore: `Lf` per dichiarazione, non per misura.
        assert_eq!(Newline::of("una riga sola"), Newline::Lf);
        assert_eq!(Newline::of(""), Newline::Lf);
    }

    #[test]
    fn chi_genera_una_riga_usa_quella_del_file() {
        assert_eq!(line_break("a\nb\n"), "\n");
        assert_eq!(line_break("a\r\nb\r\n"), "\r\n");
        assert_eq!(line_break("a\rb\r"), "\r");
        assert_eq!(line_break("senza terminatori"), "\n");
        // Misto: vince il più frequente, non il primo che si incontra.
        assert_eq!(line_break("a\nb\r\nc\r\nd\r\n"), "\r\n");
        assert_eq!(line_break("a\r\nb\nc\nd\n"), "\n");
        // `Mixed` non ha un terminatore suo, ed è per questo che `line_break`
        // non passa da `Newline::as_str`.
        assert_eq!(Newline::of("a\nb\r\nc\r\nd\r\n").as_str(), None);
    }

    #[test]
    fn il_confine_di_un_crlf_non_e_un_confine_di_carattere() {
        let source = "prima\r\ndopo\r\n";
        let dentro = source.find('\n').expect("c'è un \\n");
        // Il caso ostile: per `str` è un offset perfettamente valido…
        assert!(source.is_char_boundary(dentro));
        // …e per un edit è la metà di un terminatore di riga.
        assert!(splits_newline(source, dentro));
        // Gli estremi e i confini veri non lo sono.
        assert!(!splits_newline(source, 0));
        assert!(!splits_newline(source, source.len()));
        assert!(!splits_newline(source, 5)); // prima del `\r`
        assert!(!splits_newline(source, 7)); // dopo il `\n`
                                             // Su LF non c'è niente da spezzare.
        assert!(!splits_newline("prima\ndopo\n", 6));
    }

    #[test]
    fn cio_che_non_e_utf8_dice_dove_smette_di_esserlo() {
        assert_eq!(decode(b"testo normale"), Ok("testo normale"));
        // `0xFF` non compare in nessuna sequenza UTF-8 valida.
        assert_eq!(decode(b"buono\xffcattivo"), Err(5));
        // Una sequenza troncata: i primi byte sono validi, l'ultimo è a metà.
        assert_eq!(decode(b"caff\xc3"), Err(4));
        // Il BOM è testo valido: `decode` non lo tratta come un caso speciale.
        assert_eq!(decode("\u{feff}x".as_bytes()), Ok("\u{feff}x"));
    }
}
