//! Le entità HTML e la decodifica di un pezzo di testo come lo legge chi
//! scrive.

use super::*;

/// La tabella delle entità nominali per **nome interno** — `amp` per `&amp;`
/// — come la `ENTITY_MAP` che comrak si genera in build: costruita **una
/// volta sola** da [`ENTITIES`], tenendo le sole forme con `;` (comrak ignora
/// le varianti legacy senza punto e virgola).
static ENTITY_MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();

/// L'entità nominale `name` (ciò che sta fra `&` e `;`), o `None`.
fn named_entity(name: &str) -> Option<&'static str> {
    ENTITY_MAP
        .get_or_init(|| {
            ENTITIES
                .iter()
                .filter(|and| and.entity.starts_with('&') && and.entity.ends_with(';'))
                .map(|and| (&and.entity[1..and.entity.len() - 1], and.characters))
                .collect()
        })
        .get(name)
        .copied()
}

/// Decodifica lineare di una fetta di sorgente: escape `\X` ed entità `&…;`
/// si sciolgono in **una passata sola**, con le regole di comrak.
///
/// Comrak consegna il testo già decodificato, ma qui si riparte dalla
/// sorgente: i segmenti fra tag ed embed si misurano sul sorgente, e la
/// decodifica è locale al segmento. Le regole replicano `comrak::entity`:
///
/// - `\` + punteggiatura ASCII → quel carattere; ogni altra barra è letterale;
/// - riferimenti numerici decimali con 1..=7 cifre, esadecimali con 1..=6;
/// - entità nominali dentro una finestra di 32 byte, con `;` obbligatorio e
///   uno spazio nella finestra che uccide il candidato;
/// - codepoint 0, surrogati e ≥ U+110000 → U+FFFD;
/// - un `&` che non apre un'entità resta letterale.
///
/// Un backslash davanti a `&` ha la priorità dell'escape: `\&amp;` è `&amp;`
/// letterale, non l'entità `&`.
///
/// Lo span di un nodo di testo di comrak comincia **dal carattere escapato**,
/// non dalla barra (`\&amp;` arriva come `&amp;`, `\\&amp;` come `\&amp;`):
/// quando la barra cade sul **primo byte** della fetta, il carattere davanti
/// a `base` nel sorgente decide se era un escape. È la stessa regola di
/// [`sotto_escape`], e vale solo lì: dentro la fetta gli escape tengono la
/// loro barra e non c'è ambiguità.
pub(super) fn decode_segment(source: &str, s: &str, base: usize) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut the = 0;
    while the < s.len() {
        match bytes[the] {
            b'\\' if the == 0 && is_escaped(source, base) => {
                // Barra **decodificata** (`\\` nel sorgente): non apre un
                // escape, il prossimo carattere è testo libero.
                out.push('\\');
                the += 1;
            }
            b'\\' => match s[the + 1..].chars().next() {
                Some(c) if c.is_ascii_punctuation() => {
                    out.push(c);
                    the += 1 + c.len_utf8();
                }
                _ => {
                    out.push('\\');
                    the += 1;
                }
            },
            b'&' if the == 0 && is_escaped(source, base) => {
                // `\&…;` nel sorgente: l'escape ha sciolto la `&`, e quel che
                // segue è letterale — `\&amp;` non è l'entità `&`.
                out.push('&');
                the += 1;
            }
            b'&' => match entity(s, the, &mut out) {
                Some(end) => the = end,
                None => {
                    out.push('&');
                    the += 1;
                }
            },
            _ => {
                let c = s[the..].chars().next().expect("confine di carattere");
                out.push(c);
                the += c.len_utf8();
            }
        }
    }
    out
}

/// L'entità che comincia a `si` (`s[si] == '&'`), scritta decodificata in
/// `out`; restituisce la fine (esclusa) del consumo, o `None` se lì non c'è
/// un'entità e la `&` resta letterale. Replica `comrak::entity::unescape`.
fn entity(s: &str, is: usize, out: &mut String) -> Option<usize> {
    let text = &s[is + 1..];
    let bytes = text.as_bytes();
    // Riferimento numerico: `&#cifre;` o `&#xcifre;`. Il numero si accumula
    // cappato a U+110000 come fa comrak; il tetto delle cifre decide se è
    // un'entità, i codepoint fuori intervallo diventano U+FFFD.
    if text.len() >= 3 && bytes[0] == b'#' {
        let (cp, num_digits, is_hex, forward) = if bytes[1].is_ascii_digit() {
            let mut cp = 0u32;
            let mut the = 1;
            while the < bytes.len() && bytes[the].is_ascii_digit() {
                cp = (cp * 10 + (bytes[the] - b'0') as u32).min(0x11_0000);
                the += 1;
            }
            (cp, the - 1, false, the)
        } else if bytes[1] == b'x' || bytes[1] == b'X' {
            let mut cp = 0u32;
            let mut the = 2;
            while the < bytes.len() && bytes[the].is_ascii_hexdigit() {
                cp = (cp * 16
                    + (bytes[the] as char)
                        .to_digit(16)
                        .expect("cifra esadecimale"))
                .min(0x11_0000);
                the += 1;
            }
            (cp, the - 2, true, the)
        } else {
            (0, 0, false, 0)
        };
        if forward < bytes.len()
            && bytes[forward] == b';'
            && ((is_hex && (1..=6).contains(&num_digits))
                || (!is_hex && (1..=7).contains(&num_digits)))
        {
            // La stessa soglia di comrak: 0, i surrogati
            // e oltre U+10FFFF non sono caratteri, e un riferimento che li
            // nomina non può restare senza risposta.
            let cp = if cp == 0 || (0xD800..=0xDFFF).contains(&cp) || cp >= 0x110000 {
                0xFFFD
            } else {
                cp
            };
            out.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
            return Some(is + 1 + forward + 1);
        }
    }
    // Entità nominale: il primo `;` entro una finestra di 32 byte — uno
    // spazio uccide il candidato — e il nome prima di lui nella tabella.
    let limit = text.len().min(32);
    for j in 2..limit {
        match bytes[j] {
            b' ' => return None,
            b';' => {
                if let Some(chars) = named_entity(&text[..j]) {
                    out.push_str(chars);
                    return Some(is + 1 + j + 1);
                }
                return None;
            }
            _ => {}
        }
    }
    None
}

/// Il carattere a `idx` è sotto escape, **anche quando la barra rovescia è
/// fuori dal nodo**?
///
/// `is_escaped` guarda la fetta, e per un escape in mezzo alla fetta basta. Il
/// caso che si perdeva è quello in testa: il `sourcepos` di comrak per un
/// carattere escapato comincia **dal carattere**, non dalla barra, quindi su
/// `\#nontag` la fetta del nodo è `#nontag` e la barra è il byte prima —
/// invisibile a chi guarda solo la fetta. Il commento accanto alla chiamata
/// diceva già la cosa giusta («sul sorgente gli escape sono ancora visibili»),
/// ma la fetta non è il sorgente: il risultato era che `\#nontag` **dichiarava
/// un tag**, che finiva nell'indice e nel pannello dei tag.
pub(super) fn under_escape(source: &str, slice: &str, base: usize, idx: usize) -> bool {
    if is_escaped(slice, idx) {
        return true;
    }
    // Solo in testa, e solo se la fetta è davvero quella del sorgente a `base`:
    // il ripiego di `convert_inlines` passa il testo decodificato, e lì gli
    // offset non allineano.
    idx == 0
        && base > 0
        && source.get(base..base + slice.len()) == Some(slice)
        && is_escaped(source, base)
}
