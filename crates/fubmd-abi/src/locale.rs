//! Il **locale**: chi è l'utente che legge, e in che fuso vive (§12.3).
//!
//! # Perché è una capacità e non una costante
//!
//! Il versioning ha trovato l'argomento giusto per l'orologio
//! ([`HostEnv::now_unix_millis`](crate::traits::HostEnv::now_unix_millis)):
//! sotto sandbox un componente non ha accesso al tempo di sistema, e uno che
//! chiamasse `SystemTime::now` per conto proprio sarebbe non testabile e, sotto
//! WASI, non funzionante. Lo stesso argomento, non applicato, lasciava fuori il
//! resto di ciò che serve per **mostrare** quel tempo a qualcuno: in che fuso è,
//! con che calendario, in che lingua.
//!
//! Un `now_unix_millis` senza queste tre cose sa dire *quando* è successo e non
//! sa dirlo a nessuno. Il calendario (10.4: «first day of week», «regional
//! holidays», «workweek localization»), le note periodiche (8.3), i promemoria
//! ricorrenti (10.5, 10.1) e la ricerca per date relative (9.1) hanno tutti
//! bisogno del fuso e del calendario **dell'utente**, che un componente non può
//! dedurre e che un plugin non deve indovinare.
//!
//! # Chi lo sa davvero
//!
//! Lo sa la **shell**, e non il kernel. La webview porta un ICU intero: la
//! lingua preferita, il nome IANA del fuso, l'offset di adesso e il primo giorno
//! della settimana sono quattro righe di `Intl`. Il lato Rust, per rispondere
//! alla stessa domanda, avrebbe bisogno di un database dei fusi orari — cioè di
//! una dipendenza che il kernel non porta — e risponderebbe *peggio*.
//!
//! Quindi il locale segue la strada del contesto di sessione
//! ([decisione 0007](../../../docs/decisions/0007-contesto-di-sessione.md)): lo
//! **pubblica la shell**, il kernel lo custodisce senza derivarlo, e chi sta
//! dentro il confine lo **chiede** con [`HostEnv::locale`](crate::traits::HostEnv::locale).
//! Come `active_context`, non ha un gemello che scrive nell'`HostApi`: in che
//! lingua leggo non è una capacità da concedere a un plugin.
//!
//! # E chi lo decide
//!
//! Sopra ciò che la shell riporta stanno le **impostazioni** (§11.1): `locale.*`
//! è un pugno di chiavi di livello macchina, e una chiave vuota vuol dire
//! *«come il sistema»*. È la precedenza della
//! [decisione 0036](../../../docs/decisions/0036-le-impostazioni-e-i-tre-stati.md)
//! applicata a un fatto invece che a una preferenza: vault → macchina → ciò che
//! la shell riporta → [`Locale::default`]. Un utente italiano su un sistema
//! inglese non deve cambiare il sistema per cambiare FubMD.
//!
//! # Cosa questo record NON promette
//!
//! **Non è un database dei fusi orari.** [`Locale::utc_offset_minutes`] è
//! l'offset di *adesso*, e vale per *adesso*: applicarlo a una data di sei mesi
//! fa dà l'ora sbagliata di un'ora in mezzo mondo, perché fra allora e adesso
//! c'è passata l'ora legale. Chi formatta l'istante corrente — che è il caso di
//! quasi tutto — usa l'offset ed è a posto; chi deve fare aritmetica su date
//! passate o future usa [`Locale::timezone`], che è il nome IANA, e si porta
//! dietro le regole. La distinzione è scritta qui perché un offset presentato
//! come «il fuso» è la promessa vera a metà del quinto giro: funziona per sei
//! mesi l'anno.

use serde::{Deserialize, Serialize};

/// Il primo giorno della settimana, per chi disegna un calendario.
///
/// Non si deriva dalla lingua: `en-US` comincia di domenica e `en-GB` di lunedì,
/// e in mezzo ci sono paesi che cominciano di sabato. È un dato suo.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Weekday {
    /// Il default, ed è quello di ISO 8601.
    #[default]
    Monday,
    Tuesday,
    Wednesday,
    Thursday,
    Friday,
    Saturday,
    Sunday,
}

impl Weekday {
    /// L'ordinale ISO 8601: lunedì = 1, domenica = 7.
    pub fn iso(self) -> u8 {
        match self {
            Weekday::Monday => 1,
            Weekday::Tuesday => 2,
            Weekday::Wednesday => 3,
            Weekday::Thursday => 4,
            Weekday::Friday => 5,
            Weekday::Saturday => 6,
            Weekday::Sunday => 7,
        }
    }

    /// Dall'ordinale ISO 8601. Fuori da `1..=7` è `None`: un giorno della
    /// settimana numero 9 non è un giorno da correggere in silenzio.
    pub fn from_iso(n: u8) -> Option<Weekday> {
        Some(match n {
            1 => Weekday::Monday,
            2 => Weekday::Tuesday,
            3 => Weekday::Wednesday,
            4 => Weekday::Thursday,
            5 => Weekday::Friday,
            6 => Weekday::Saturday,
            7 => Weekday::Sunday,
            _ => return None,
        })
    }
}

/// Orologio a 12 o a 24 ore.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HourCycle {
    /// `14:30`. Il default, ed è quello di ISO 8601.
    #[default]
    H23,
    /// `2:30 PM`.
    H12,
}

/// Chi legge, e da dove: la lingua, il fuso, il calendario.
///
/// Un record solo e non quattro capacità separate, perché è **una** risposta:
/// chi la chiede la chiede tutta — formattare una data vuole il fuso *e* la
/// lingua *e* l'orologio — e quattro chiamate darebbero quattro istantanee che
/// possono venire da momenti diversi. È lo stesso argomento di
/// [`SettingEntry`](crate::settings::SettingEntry), che tiene insieme schema,
/// valore e provenienza per non farli riconciliare a chi disegna.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Locale {
    /// Il tag BCP-47 della lingua: `it-IT`, `en-US`, `de`.
    ///
    /// È l'unico campo con cui si sceglie una traduzione, e la scelta scende di
    /// specificità: `it-IT` → `it` → la lingua di default del catalogo → la
    /// chiave. Vedi [`Locale::language_base`].
    pub language: String,
    /// Il nome IANA del fuso: `Europe/Rome`. Vuoto = nessuno l'ha detto.
    ///
    /// È il campo per chi fa **aritmetica** su date che non sono adesso: porta
    /// con sé le regole dell'ora legale, che l'offset non ha. Chi lo usa si
    /// porta il database; chi non ce l'ha usa
    /// [`utc_offset_minutes`](Locale::utc_offset_minutes) e sa cosa sta
    /// approssimando.
    pub timezone: String,
    /// Minuti da aggiungere a UTC per ottenere l'ora locale **adesso**:
    /// `Europe/Rome` d'inverno è `60`, d'estate `120`; `America/New_York`
    /// d'inverno è `-300`.
    ///
    /// Minuti e non ore perché ci sono fusi a mezz'ora (`Asia/Kolkata`, `+330`)
    /// e a quarantacinque minuti (`Asia/Kathmandu`, `+345`): un campo in ore
    /// avrebbe reso inesprimibile il fuso di un miliardo e mezzo di persone.
    pub utc_offset_minutes: i16,
    pub first_day_of_week: Weekday,
    pub hour_cycle: HourCycle,
}

/// Il tag BCP-47 di *lingua non determinata*. È il default di
/// [`Locale::language`], e non è una scelta di comodo: `und` è ciò che lo
/// standard dice quando nessuno ha detto niente, mentre un default `it-IT`
/// avrebbe cablato un paese dentro il contratto — e chi lo riceve non saprebbe
/// distinguere «l'utente ha scelto l'italiano» da «nessuno ha ancora parlato».
pub const UNDETERMINED: &str = "und";

impl Default for Locale {
    /// Il locale di chi non ha ancora sentito nessuno: lingua indeterminata,
    /// UTC, e il resto come lo dice ISO 8601.
    ///
    /// È ciò che riceve un host senza shell — la CLI (27.1), un test, un job che
    /// gira prima che la finestra si sia aperta — ed è **deterministico** di
    /// proposito: è la stessa ragione per cui l'orologio è una capacità e non
    /// una chiamata di sistema.
    fn default() -> Self {
        Locale {
            language: UNDETERMINED.to_string(),
            timezone: String::new(),
            utc_offset_minutes: 0,
            first_day_of_week: Weekday::default(),
            hour_cycle: HourCycle::default(),
        }
    }
}

impl Locale {
    /// La sola lingua, senza regione: `it` da `it-IT`, `it` da `it`.
    ///
    /// È il secondo passo della ricerca di una traduzione: un catalogo che
    /// dichiara `it` deve servire anche chi chiede `it-CH`, o ogni catalogo
    /// dovrebbe elencare tutte le regioni per essere utile a una.
    pub fn language_base(&self) -> &str {
        self.language
            .split(['-', '_'])
            .next()
            .unwrap_or(&self.language)
    }

    /// Qualcuno ha detto in che lingua legge?
    ///
    /// `false` quando il campo è vuoto o vale [`UNDETERMINED`]: chi risolve una
    /// traduzione, in quel caso, va dritto alla lingua di default del catalogo
    /// invece di cercare un catalogo `und` che nessuno scriverà mai.
    pub fn has_language(&self) -> bool {
        !self.language.is_empty() && self.language != UNDETERMINED
    }

    /// Millisecondi UTC → millisecondi **civili**, cioè l'istante come lo legge
    /// un orologio da parete dell'utente.
    ///
    /// Vale per adesso e per le sue vicinanze, con l'avvertenza del doc del
    /// modulo: l'offset è quello di oggi, non quello che c'era alla data che si
    /// sta convertendo.
    pub fn to_civil_millis(&self, utc_millis: u64) -> i64 {
        utc_millis as i64 + self.utc_offset_minutes as i64 * 60_000
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_default_names_no_country() {
        let d = Locale::default();
        assert_eq!(d.language, "und");
        assert!(!d.has_language());
        assert_eq!(d.utc_offset_minutes, 0);
        assert_eq!(d.first_day_of_week, Weekday::Monday);
        assert_eq!(d.hour_cycle, HourCycle::H23);
    }

    #[test]
    fn a_regional_tag_falls_back_to_its_language() {
        let l = Locale {
            language: "it-CH".into(),
            ..Locale::default()
        };
        assert_eq!(l.language_base(), "it");
        assert!(l.has_language());
        // La forma con l'underscore arriva da chi legge `LANG=it_IT.UTF-8`.
        let l = Locale {
            language: "it_IT".into(),
            ..Locale::default()
        };
        assert_eq!(l.language_base(), "it");
    }

    /// I fusi a mezz'ora e a tre quarti d'ora esistono, e il campo li regge.
    #[test]
    fn half_hour_zones_are_expressible() {
        let kathmandu = Locale {
            utc_offset_minutes: 345,
            ..Locale::default()
        };
        assert_eq!(kathmandu.to_civil_millis(0), 345 * 60_000);
        let honolulu = Locale {
            utc_offset_minutes: -600,
            ..Locale::default()
        };
        assert_eq!(honolulu.to_civil_millis(0), -600 * 60_000);
    }

    #[test]
    fn iso_weekdays_round_trip() {
        for n in 1..=7u8 {
            assert_eq!(Weekday::from_iso(n).unwrap().iso(), n);
        }
        assert_eq!(Weekday::from_iso(0), None);
        assert_eq!(Weekday::from_iso(8), None);
    }

    /// La resa JSON è quella che attraversa l'IPC e che il mirror TS dichiara.
    #[test]
    fn the_wire_shape_is_the_declared_one() {
        let json = serde_json::to_value(Locale::default()).unwrap();
        assert_eq!(json["language"], "und");
        assert_eq!(json["utc_offset_minutes"], 0);
        assert_eq!(json["first_day_of_week"], "monday");
        assert_eq!(json["hour_cycle"], "h23");
    }
}
