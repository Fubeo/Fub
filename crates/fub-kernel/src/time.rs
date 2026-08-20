//! Il minimo di aritmetica del tempo che serve al kernel.
//!
//! I file del cestino portano la data nel nome (`Nota.2026-07-24T15-30-00.md`,
//! vedi `docs/PIANO.md`, "Decisioni (con il perché)") e devono restare
//! leggibili da chi apre il vault con un file manager — anche da Obsidian, che
//! di Fub non sa nulla.
//!
//! Scritto a mano invece che con una dipendenza perché la superficie che serve
//! è tutta qui: un istante UTC in secondi e la sua forma stampabile. Il kernel
//! non porta dipendenze che non siano il contratto.
//!
//! Il calendario vero e proprio — `civil_from_days` — è **salito nel
//! contratto** ([`fub_abi::locale::civil_from_days`]) quando gli è nato un
//! secondo cliente dentro il confine: un argomento
//! [`Timestamp`](fub_abi::text::ArgValue::Timestamp) di un messaggio si
//! formatta secondo il locale di chi guarda, e il contratto non può farsi
//! prestare un pezzo di kernel. Qui resta ciò che è davvero dell'host: leggere
//! l'orologio, e scrivere un nome di file che Windows accetti.

use fub_abi::locale::civil_from_days;
use std::time::{SystemTime, UNIX_EPOCH};

/// Secondi dall'epoca UNIX. Un orologio impostato prima del 1970 vale 0: una
/// data assurda può rendere brutto un nome di file, non far fallire una
/// cancellazione.
pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Millisecondi dall'epoca UNIX.
///
/// Più fine dei secondi perché serve a **identificare** uno snapshot, non a
/// mostrarlo: il debounce dell'editor è di 400 ms, e due salvataggi nello
/// stesso secondo non devono essere lo stesso istante.
pub fn now_unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// L'istante in `YYYY-MM-DDTHH-MM-SS`, UTC.
///
/// I `:` dell'ISO 8601 diventano `-`: Windows non li accetta nei nomi di file,
/// e questa stringa in un nome di file ci finisce.
pub fn stamp_from_unix(secs: u64) -> String {
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}-{:02}-{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Ora, in [`stamp_from_unix`].
pub fn now_stamp() -> String {
    stamp_from_unix(now_unix())
}

/// L'istante in `YYYY-MM-DDTHH:MM:SS.mmmZ`, UTC — la forma che si **legge**.
///
/// È la gemella di [`stamp_from_unix`] e la differenza è un carattere: qui i
/// `:` ci sono. Non è una svista da unificare: quella scrive dentro un **nome
/// di file** e Windows i `:` non li accetta, questa scrive dentro una **riga di
/// log** (§17.3) che una persona legge e un `grep` filtra, e là l'ISO vero vale
/// più della portabilità di un nome che non esiste. Due mestieri, due forme.
///
/// I millisecondi ci sono perché ciò che si guarda in un log è spesso
/// l'**ordine** di due righe vicine, e due righe nello stesso secondo sono la
/// norma quando qualcosa va storto in cascata.
pub fn stamp_iso_millis(millis: u64) -> String {
    let secs = millis / 1_000;
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        millis % 1_000
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_instants_print_as_utc() {
        assert_eq!(stamp_from_unix(0), "1970-01-01T00-00-00");
        assert_eq!(stamp_from_unix(1_700_000_000), "2023-11-14T22-13-20");
        // 2100 non è bisestile benché divisibile per 4: la regola dei secoli.
        assert_eq!(stamp_from_unix(4_102_444_800), "2100-01-01T00-00-00");
    }

    #[test]
    fn leap_days_exist() {
        assert_eq!(stamp_from_unix(1_709_164_800), "2024-02-29T00-00-00");
        // Divisibile per 400: bisestile, a differenza del 2100.
        assert_eq!(stamp_from_unix(951_782_400), "2000-02-29T00-00-00");
    }

    /// Il vero contratto: giorno per giorno, per trent'anni, la data avanza di
    /// un giorno e mai di due — è il modo più economico di verificare che mesi,
    /// anni e bisestili si incastrino senza buchi né sovrapposizioni.
    #[test]
    fn the_calendar_advances_one_day_at_a_time() {
        let days_of_the_mese = |y: i64, m: u64| -> u64 {
            match m {
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                4 | 6 | 9 | 11 => 30,
                _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
                _ => 28,
            }
        };
        let (mut y, mut m, mut d) = (1970i64, 1u64, 1u64);
        for day in 0..(30 * 365 + 8) {
            let expected = format!("{y:04}-{m:02}-{d:02}T00-00-00");
            assert_eq!(stamp_from_unix(day * 86_400), expected);
            d += 1;
            if d > days_of_the_mese(y, m) {
                d = 1;
                m += 1;
            }
            if m > 12 {
                m = 1;
                y += 1;
            }
        }
    }

    /// La forma che si legge porta i `:` che quella dei nomi di file non può
    /// portare, e i millisecondi che quella non ha.
    #[test]
    fn the_readable_stamp_is_the_other_one_with_colons_and_millis() {
        assert_eq!(stamp_iso_millis(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            stamp_iso_millis(1_700_000_000_123),
            "2023-11-14T22:13:20.123Z"
        );
        // Lo stesso istante, nelle due forme: cambiano solo i separatori e la
        // coda dei millesimi.
        assert_eq!(stamp_from_unix(1_700_000_000), "2023-11-14T22-13-20");
    }

    #[test]
    fn a_stamp_never_carries_characters_a_filename_cannot() {
        let s = now_stamp();
        assert!(!s.contains(':') && !s.contains('/') && !s.contains('\\'));
        assert_eq!(s.len(), 19);
    }
}
