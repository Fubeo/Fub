//! Il minimo di aritmetica del tempo che serve al kernel.
//!
//! I file del cestino portano la data nel nome (`Nota.2026-07-24T15-30-00.md`,
//! vedi `docs/CRUD_E_VAULT.md`, D2) e devono restare leggibili da chi apre il
//! vault con un file manager — anche da Obsidian, che di FubMD non sa nulla.
//!
//! Scritto a mano invece che con una dipendenza perché la superficie che serve
//! è tutta qui: un istante UTC in secondi e la sua forma stampabile. Il kernel
//! non porta dipendenze che non siano il contratto.

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

/// Data civile (anno, mese, giorno) dai giorni trascorsi dall'epoca UNIX.
///
/// È l'algoritmo `civil_from_days` di Howard Hinnant: calendario gregoriano
/// proiettato all'indietro, esatto su tutto l'intervallo che un `u64` di
/// secondi può esprimere. L'idea è spostare l'inizio dell'anno a marzo, così i
/// giorni bisestili cadono in fondo e l'aritmetica del mese diventa lineare.
fn civil_from_days(days: i64) -> (i64, u64, u64) {
    // Origine spostata al 2000-03-01, primo giorno di un'era di 400 anni.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // giorno nell'era, [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // giorno nell'anno di marzo
    let mp = (5 * doy + 2) / 153; // mese con marzo = 0
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe as i64 + era * 400;
    (if m <= 2 { y + 1 } else { y }, m, d)
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
        let giorni_del_mese = |y: i64, m: u64| -> u64 {
            match m {
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                4 | 6 | 9 | 11 => 30,
                _ if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
                _ => 28,
            }
        };
        let (mut y, mut m, mut d) = (1970i64, 1u64, 1u64);
        for giorno in 0..(30 * 365 + 8) {
            let atteso = format!("{y:04}-{m:02}-{d:02}T00-00-00");
            assert_eq!(stamp_from_unix(giorno * 86_400), atteso);
            d += 1;
            if d > giorni_del_mese(y, m) {
                d = 1;
                m += 1;
            }
            if m > 12 {
                m = 1;
                y += 1;
            }
        }
    }

    #[test]
    fn a_stamp_never_carries_characters_a_filename_cannot() {
        let s = now_stamp();
        assert!(!s.contains(':') && !s.contains('/') && !s.contains('\\'));
        assert_eq!(s.len(), 19);
    }
}
