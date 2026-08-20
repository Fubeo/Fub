//! Il **locale**: chi lo riporta, chi lo decide, e chi tiene le due cose
//! insieme (§12.3).
//!
//! # Due sorgenti, e una precedenza sola
//!
//! Il locale non è né un fatto puro né una preferenza pura: è tutti e due, e la
//! confusione fra i due è il modo in cui questa roba si scrive male.
//!
//! - **Ciò che il sistema è**: la lingua del sistema operativo, il fuso, il
//!   primo giorno della settimana. Lo riporta la **shell**, perché la webview
//!   porta un ICU intero e il lato Rust, per rispondere alla stessa domanda,
//!   avrebbe bisogno di un database dei fusi orari — cioè di una dipendenza che
//!   il kernel non porta, per dare una risposta peggiore. Lo tiene
//!   [`SystemLocale`], che è **uno per processo** e non uno per vault: la lingua
//!   di chi guarda non cambia perché si apre un secondo vault.
//! - **Ciò che l'utente ha scelto**: le chiavi `locale.*` (§11.1), che vincono.
//!   Una chiave vuota vuol dire *«come il sistema»*, e non «vuoto»: è il modo in
//!   cui un default può dire «non decidere tu».
//!
//! La precedenza è quella della
//! [decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)
//! come la
//! [0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md) l'ha
//! ridotta, con un gradino in più in fondo: **vault → ciò che la shell riporta
//! → [`Locale::default`]**. Il gradino nuovo sta *sotto* la configurazione e
//! *sopra* il default dello schema, ed è l'unico posto in cui poteva stare: un
//! fatto del sistema non ha titolo a scavalcare una scelta dell'utente, e ha
//! tutto il titolo a scavalcare un default scritto in un contratto che non sa
//! dove gira.
//!
//! # Perché non è una singola impostazione
//!
//! Perché [`Locale`] è cinque campi e un'impostazione ha un valore. Cinque
//! chiavi separate permettono la cosa che serve davvero: scegliere la lingua
//! senza toccare il fuso, che è il caso di chiunque lavori in una lingua che non
//! è quella del posto in cui vive.

use std::sync::RwLock;

use fub_abi::locale::{HourCycle, Locale, Weekday};
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};
use fub_abi::ui::UiOption;

/// La lingua in cui leggere l'interfaccia. Vuota = quella del sistema.
pub const LANGUAGE: &str = "locale.language";
/// Il nome IANA del fuso. Vuoto = quello del sistema.
pub const TIMEZONE: &str = "locale.timezone";
/// Il primo giorno della settimana. Vuoto = quello del sistema.
pub const FIRST_DAY: &str = "locale.first-day-of-week";
/// Orologio a 12 o a 24 ore. Vuoto = quello del sistema.
pub const HOUR_CYCLE: &str = "locale.hour-cycle";

/// Il valore che vuol dire **«come il sistema»**.
///
/// È la stringa vuota e non una parola come `"system"` per una ragione sola: la
/// stringa vuota è ciò che si ottiene *non scegliendo*, quindi è anche il
/// default naturale dello schema, e le due cose non possono divergere. Con una
/// parola sentinella ci sarebbero stati due modi di dire la stessa cosa — il
/// default e la parola — e un file scritto a mano con `""` avrebbe voluto dire
/// una terza.
pub const AS_SYSTEM: &str = "";

/// Ciò che il **sistema** è, secondo chi lo sa: uno per processo, scritto dalla
/// shell, letto da ogni vault aperto.
///
/// Un `RwLock` e non un `Arc<Locale>` immutabile perché il locale **cambia
/// mentre l'app è viva**: l'utente sposta il fuso del sistema, o passa la
/// mezzanotte dell'ultima domenica di ottobre e l'offset cambia da solo. Chi
/// legge non aspetta chi legge, ed è la regola della
/// [decisione 0024](../../../docs/decisions/0024-chi-legge-non-aspetta-chi-legge.md).
#[derive(Debug, Default)]
pub struct SystemLocale {
    inner: RwLock<Locale>,
}

impl SystemLocale {
    /// Il locale che la shell ha riportato, o [`Locale::default`] se non ha
    /// ancora parlato.
    ///
    /// Un lock avvelenato rende il default invece di andare in panico: che la
    /// lingua torni indeterminata è un peggioramento visibile e reversibile,
    /// mentre far cadere ogni `render_view` di un'app viva perché un thread è
    /// morto tenendo il lock del *fuso orario* non lo è.
    pub fn get(&self) -> Locale {
        self.inner
            .read()
            .map(|the| the.clone())
            .unwrap_or_else(|_| Locale::default())
    }

    /// La shell riporta cosa il sistema dice adesso. Rende `true` se è cambiato
    /// qualcosa — chi lo chiama decide se avvisare qualcuno.
    pub fn publish(&self, locale: Locale) -> bool {
        match self.inner.write() {
            Ok(mut guard) => {
                let changed = *guard != locale;
                *guard = locale;
                changed
            }
            Err(_) => false,
        }
    }
}

/// Le impostazioni che il core dichiara per il locale.
///
/// Sono di livello **vault**, come tutto il resto
/// ([0076](../../../docs/decisions/0076-le-impostazioni-vivono-nel-vault.md)).
/// Erano di macchina, con l'argomento della 0036 — un vault arriva da fuori e
/// non decide in che lingua leggi — e l'argomento non regge il suo prezzo: una
/// lingua imposta è visibile e si cambia in un gesto, mentre la precedenza fra
/// due file è una regola che chiunque tocchi queste chiavi deve tenere a mente.
/// Senza un vault aperto non serve un livello di riserva: il default è
/// [`AS_SYSTEM`], cioè l'app segue il sistema operativo finché qualcuno non
/// apre un vault che ha deciso altro.
///
/// Nessuna è `program_writable`, e quello non è cambiato: la lingua di chi
/// legge è dell'utente, e un componente che potesse cambiarla avrebbe il modo
/// di rendere l'app illeggibile a chi lo ha installato.
pub fn locale_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            LANGUAGE,
            Text::key(THE_LANGUAGE),
            SettingKind::Text {
                default: AS_SYSTEM.into(),
            },
        )
        .describing(Text::key(THE_LANGUAGE_DESC))
        .grouped(Text::key(THE_GROUP)),
        SettingSpec::new(
            TIMEZONE,
            Text::key(THE_TIMEZONE),
            SettingKind::Text {
                default: AS_SYSTEM.into(),
            },
        )
        .describing(Text::key(THE_TIMEZONE_DESC))
        .grouped(Text::key(THE_GROUP)),
        SettingSpec::new(
            FIRST_DAY,
            Text::key(THE_FIRST_DAY),
            SettingKind::Choice {
                default: AS_SYSTEM.into(),
                options: vec![
                    UiOption::new(AS_SYSTEM, Text::key(AS_SYSTEM_KEY)),
                    UiOption::new("monday", Text::key(THE_MONDAY)),
                    UiOption::new("saturday", Text::key(THE_SATURDAY)),
                    UiOption::new("sunday", Text::key(THE_SUNDAY)),
                ],
            },
        )
        .describing(Text::key(THE_FIRST_DAY_DESC))
        .grouped(Text::key(THE_GROUP)),
        SettingSpec::new(
            HOUR_CYCLE,
            Text::key(THE_HOUR_CYCLE),
            SettingKind::Choice {
                default: AS_SYSTEM.into(),
                options: vec![
                    UiOption::new(AS_SYSTEM, Text::key(AS_SYSTEM_KEY)),
                    UiOption::new("h23", Text::key(THE_H23)),
                    UiOption::new("h12", Text::key(THE_H12)),
                ],
            },
        )
        .describing(Text::key(THE_HOUR_CYCLE_DESC))
        .grouped(Text::key(THE_GROUP)),
    ]
}

/// Le chiavi delle stringhe del locale. Nude, come vuole il contratto: a
/// qualificarle è l'host con l'id del componente che le porta — il core.
const THE_GROUP: &str = "locale.group";
/// «Come il sistema»: pubblica, perché la dice anche una chiave che non è del
/// locale — `appearance.theme` — e due traduzioni della stessa scelta in due
/// tendine vicine sono la prima cosa che si nota.
pub const AS_SYSTEM_KEY: &str = "locale.as_system";
const THE_LANGUAGE: &str = "locale.language";
const THE_LANGUAGE_DESC: &str = "locale.language.desc";
const THE_TIMEZONE: &str = "locale.timezone";
const THE_TIMEZONE_DESC: &str = "locale.timezone.desc";
const THE_FIRST_DAY: &str = "locale.first_day";
const THE_FIRST_DAY_DESC: &str = "locale.first_day.desc";
const THE_MONDAY: &str = "locale.first_day.monday";
const THE_SATURDAY: &str = "locale.first_day.saturday";
const THE_SUNDAY: &str = "locale.first_day.sunday";
const THE_HOUR_CYCLE: &str = "locale.hour_cycle";
const THE_HOUR_CYCLE_DESC: &str = "locale.hour_cycle.desc";
const THE_H23: &str = "locale.hour_cycle.h23";
const THE_H12: &str = "locale.hour_cycle.h12";

/// Le stringhe delle impostazioni del locale, nelle due lingue che questo repo
/// scrive.
///
/// Sta **qui** e non accanto alle altre chiavi del core, che vivono in
/// `fub-host`, per la ragione più semplice che ci sia: le impostazioni che
/// descrive stanno qui. Un catalogo che si allontana dalle stringhe che
/// traduce è un catalogo che si aggiorna a metà.
///
/// Le due metà arrivano al montaggio come **due cataloghi della stessa
/// lingua**, e si sommano: vedi
/// [`Strings::template`](fub_abi::text::Strings::template).
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(THE_GROUP, "Locale")
            .with(AS_SYSTEM_KEY, "Come il sistema")
            .with(THE_LANGUAGE, "Lingua")
            .with(
                THE_LANGUAGE_DESC,
                "Il tag BCP-47 della lingua dell'interfaccia (`it`, `it-IT`, `en-US`). \
                 Vuoto = quella del sistema.",
            )
            .with(THE_TIMEZONE, "Fuso orario")
            .with(
                THE_TIMEZONE_DESC,
                "Il nome IANA del fuso (`Europe/Rome`). Vuoto = quello del sistema. \
                 Cambiarlo qui non cambia l'orologio del sistema: cambia come Fub \
                 mostra le date, e a che ora suonano le sveglie dei componenti \
                 che ne dichiarano una a un orario di parete.",
            )
            .with(THE_FIRST_DAY, "Primo giorno della settimana")
            .with(
                THE_FIRST_DAY_DESC,
                "Da che giorno comincia la settimana nel calendario.",
            )
            .with(THE_MONDAY, "Lunedì")
            .with(THE_SATURDAY, "Sabato")
            .with(THE_SUNDAY, "Domenica")
            .with(THE_HOUR_CYCLE, "Orologio")
            .with(
                THE_HOUR_CYCLE_DESC,
                "Se mostrare le ore da 0 a 23 o da 1 a 12 con AM/PM.",
            )
            .with(THE_H23, "24 ore")
            .with(THE_H12, "12 ore"),
        StringCatalog::new("en")
            .with(THE_GROUP, "Locale")
            .with(AS_SYSTEM_KEY, "Same as system")
            .with(THE_LANGUAGE, "Language")
            .with(
                THE_LANGUAGE_DESC,
                "The BCP-47 tag of the interface language (`it`, `it-IT`, `en-US`). \
                 Empty = the system one.",
            )
            .with(THE_TIMEZONE, "Time zone")
            .with(
                THE_TIMEZONE_DESC,
                "The IANA name of the time zone (`Europe/Rome`). Empty = the system \
                 one. Changing it here does not change the system clock: it changes \
                 how Fub shows dates, and what time wall-clock alarms declared by \
                 components go off.",
            )
            .with(THE_FIRST_DAY, "First day of the week")
            .with(THE_FIRST_DAY_DESC, "Which day the calendar week starts on.")
            .with(THE_MONDAY, "Monday")
            .with(THE_SATURDAY, "Saturday")
            .with(THE_SUNDAY, "Sunday")
            .with(THE_HOUR_CYCLE, "Clock")
            .with(
                THE_HOUR_CYCLE_DESC,
                "Whether to show hours from 0 to 23 or from 1 to 12 with AM/PM.",
            )
            .with(THE_H23, "24-hour")
            .with(THE_H12, "12-hour"),
    ]
}

/// Il locale che vale **adesso**: ciò che la shell riporta, con sopra ciò che
/// l'utente ha scelto.
///
/// `setting` è la lettura dello store già risolta per precedenza (vault →
/// macchina → default dello schema): questa funzione non sa quale dei due
/// livelli ha vinto, e non deve saperlo — sa solo distinguere «l'utente ha
/// scelto» da «l'utente ha detto: come il sistema».
///
/// Un valore che l'utente ha scritto e che non si sa leggere — `first-day-of-week`
/// a `martedì`, `hour-cycle` a `h24` — **cade sul sistema** invece di far fallire
/// la lettura: il locale è una cosa che serve a ogni render, e una
/// configurazione sbagliata a mano non deve rendere l'app muta. Che quel valore
/// non sia stato accettato lo dice il pannello, che mostra ciò che vale.
pub fn resolve(system: &Locale, mut setting: impl FnMut(&str) -> Option<String>) -> Locale {
    let selected = |key: &str, setting: &mut dyn FnMut(&str) -> Option<String>| {
        setting(key).filter(|v| v != AS_SYSTEM)
    };

    let language = selected(LANGUAGE, &mut setting).unwrap_or_else(|| system.language.clone());
    let timezone = selected(TIMEZONE, &mut setting);
    // L'offset segue il **fuso**: se l'utente ne ha scelto uno diverso da quello
    // del sistema, l'offset del sistema non è più il suo, e tenerlo darebbe la
    // combinazione peggiore di tutte — il nome di un fuso con l'ora di un altro.
    // Chi ha il database dei fusi legge il nome; chi non ce l'ha vede uno zero e
    // sa che sta guardando UTC, che è sbagliato in modo dichiarato.
    let utc_offset_minutes = match &timezone {
        Some(tz) if *tz != system.timezone => 0,
        _ => system.utc_offset_minutes,
    };

    Locale {
        language,
        timezone: timezone.unwrap_or_else(|| system.timezone.clone()),
        utc_offset_minutes,
        first_day_of_week: selected(FIRST_DAY, &mut setting)
            .and_then(|v| weekday_from_key(&v))
            .unwrap_or(system.first_day_of_week),
        hour_cycle: selected(HOUR_CYCLE, &mut setting)
            .and_then(|v| hour_cycle_from_key(&v))
            .unwrap_or(system.hour_cycle),
    }
}

/// Il valore di `locale.first-day-of-week` → il giorno. Ignoto = `None`, e chi
/// chiama cade sul sistema.
fn weekday_from_key(v: &str) -> Option<Weekday> {
    Some(match v {
        "monday" => Weekday::Monday,
        "tuesday" => Weekday::Tuesday,
        "wednesday" => Weekday::Wednesday,
        "thursday" => Weekday::Thursday,
        "friday" => Weekday::Friday,
        "saturday" => Weekday::Saturday,
        "sunday" => Weekday::Sunday,
        _ => return None,
    })
}

/// Il valore di `locale.hour-cycle` → l'orologio.
fn hour_cycle_from_key(v: &str) -> Option<HourCycle> {
    Some(match v {
        "h23" => HourCycle::H23,
        "h12" => HourCycle::H12,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn system_state() -> Locale {
        Locale {
            language: "en-US".into(),
            timezone: "America/New_York".into(),
            utc_offset_minutes: -300,
            first_day_of_week: Weekday::Sunday,
            hour_cycle: HourCycle::H12,
        }
    }

    fn store(pairs: &[(&str, &str)]) -> impl FnMut(&str) -> Option<String> {
        let map: BTreeMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| map.get(k).cloned()
    }

    #[test]
    fn with_nobody_choosing_the_system_wins_whole() {
        assert_eq!(resolve(&system_state(), store(&[])), system_state());
    }

    /// La ragione per cui le chiavi sono cinque e non una: scegliere la lingua
    /// senza toccare il fuso.
    #[test]
    fn the_language_moves_without_the_clock() {
        let r = resolve(&system_state(), store(&[(LANGUAGE, "it-IT")]));
        assert_eq!(r.language, "it-IT");
        assert_eq!(r.timezone, "America/New_York");
        assert_eq!(r.utc_offset_minutes, -300);
        assert_eq!(r.hour_cycle, HourCycle::H12);
    }

    #[test]
    fn an_empty_value_means_as_the_system_and_not_empty() {
        let r = resolve(&system_state(), store(&[(LANGUAGE, ""), (TIMEZONE, "")]));
        assert_eq!(r.language, "en-US");
        assert_eq!(r.timezone, "America/New_York");
    }

    /// Il nome di un fuso con l'ora di un altro è la combinazione peggiore: chi
    /// sceglie un fuso diverso da quello del sistema perde l'offset, invece di
    /// tenersi quello sbagliato.
    #[test]
    fn choosing_another_zone_drops_the_offset_of_this_one() {
        let r = resolve(&system_state(), store(&[(TIMEZONE, "Europe/Rome")]));
        assert_eq!(r.timezone, "Europe/Rome");
        assert_eq!(
            r.utc_offset_minutes, 0,
            "New York's offset is not Rome's"
        );
        // Riscegliere quello del sistema lo riprende.
        let r = resolve(&system_state(), store(&[(TIMEZONE, "America/New_York")]));
        assert_eq!(r.utc_offset_minutes, -300);
    }

    #[test]
    fn a_value_nobody_can_read_falls_back_instead_of_failing() {
        let r = resolve(
            &system_state(),
            store(&[(FIRST_DAY, "martedì"), (HOUR_CYCLE, "h24")]),
        );
        assert_eq!(r.first_day_of_week, Weekday::Sunday);
        assert_eq!(r.hour_cycle, HourCycle::H12);
    }

    #[test]
    fn the_shell_speaks_and_everyone_sees_it() {
        let system = SystemLocale::default();
        assert_eq!(system.get(), Locale::default());
        assert!(system.publish(system_state()));
        assert_eq!(system.get(), system_state());
        assert!(
            !system.publish(system_state()),
            "republishing the same value is not a change"
        );
    }

    /// Ogni chiave dichiarata vive nel vault e nessuna è scrivibile da un
    /// programma: la lingua di chi legge è dell'utente, e viaggia col vault che
    /// sta leggendo (0076).
    #[test]
    fn no_component_can_change_the_language_of_who_reads() {
        for spec in locale_settings() {
            assert_eq!(
                spec.scope,
                fub_abi::settings::SettingScope::Vault,
                "would not travel with the vault: {}",
                spec.key
            );
            assert!(
                !spec.program_writable,
                "is writable by a program: {}",
                spec.key
            );
        }
    }
}
