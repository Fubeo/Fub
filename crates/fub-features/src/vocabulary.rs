//! Il vocabolario delle date e delle ore che un testo può citare fra doppie
//! graffe: `{{date}}`, `{{time}}`, `{{datetime}}`, `{{year}}`, `{{month}}`,
//! `{{day}}`, `{{hour}}`, `{{minute}}`.
//!
//! Lo parlano i template (`note.from_template` e compagni) e le ricette: un
//! solo modo di dire «oggi» nel fuso di chi usa Fub, perché due copie della
//! stessa regola finirebbero per dare due date diverse alla stessa mezzanotte.
//! Il modulo non nomina nessuna feature: ciò che è dei template (`{{title}}`,
//! `{{random}}`, le cascate) resta nei template, ciò che è delle ricette
//! (`{{doc}}`, `{{param.<nome>}}`, il tipo che il segnaposto esatto conserva)
//! resta nelle ricette.

use fub_abi::error::PluginError;
use fub_abi::locale::{civil_from_days, HourCycle, Locale};
use fub_abi::text::{Arg, Text};
use fub_abi::traits::ReadApi;

/// Il fuso nominato non esiste (chiave dei cataloghi di chi usa il modulo).
pub(crate) const E_BAD_ZONE: &str = "e_bad_zone";
/// L'istante dell'orologio non si rappresenta nel fuso.
pub(crate) const E_BAD_INSTANT: &str = "e_bad_instant";

/// I nomi delle date e delle ore, senza graffe, nell'ordine in cui
/// [`expand_dates`] li sostituisce.
pub const DATE_NAMES: &[&str] = &[
    "datetime", "date", "time", "year", "month", "day", "hour", "minute",
];

/// Il contesto di espansione: data e ora **civili** dell'utente, dal suo fuso.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ctx {
    pub date: String,
    pub time: String,
    pub datetime: String,
    pub year: String,
    pub month: String,
    pub day: String,
    pub hour: String,
    pub minute: String,
}

impl Ctx {
    /// Il valore del segnaposto `name` (senza graffe), se è una data o un'ora
    /// del vocabolario.
    pub fn get(&self, name: &str) -> Option<&str> {
        Some(match name {
            "date" => &self.date,
            "time" => &self.time,
            "datetime" => &self.datetime,
            "year" => &self.year,
            "month" => &self.month,
            "day" => &self.day,
            "hour" => &self.hour,
            "minute" => &self.minute,
            _ => return None,
        })
    }
}

/// Contesto di adesso, dall'orologio e dal fuso dell'host (deterministico nei
/// test via `MemoryHost`, mai `SystemTime` diretto).
pub fn context(host: &dyn ReadApi) -> Result<Ctx, PluginError> {
    let locale = host.user_locale();
    context_at(host.now_unix_millis(), &locale)
}

/// Il contesto dell'istante `now_ms` (millisecondi UTC) nel fuso di `locale`.
pub fn context_at(now_ms: u64, locale: &Locale) -> Result<Ctx, PluginError> {
    let (y, m, d, hh, mm) = civil_parts(now_ms, locale)?;
    let date = format!("{y:04}-{m:02}-{d:02}");
    let time = format_time(hh, mm, locale.hour_cycle);
    Ok(Ctx {
        date: date.clone(),
        time: time.clone(),
        datetime: format!("{date} {time}"),
        year: format!("{y:04}"),
        month: format!("{m:02}"),
        day: format!("{d:02}"),
        hour: format!("{hh:02}"),
        minute: format!("{mm:02}"),
    })
}

/// An explicitly named zone owns its historical/DST offset; the host's
/// snapshot offset is used only when it supplied no named zone.
pub fn civil_parts(now_ms: u64, locale: &Locale) -> Result<(i64, u64, u64, u64, u64), PluginError> {
    let name = locale.timezone.trim();
    if !name.is_empty() {
        let zone = jiff::tz::TimeZone::get(name).map_err(|_| {
            PluginError::BadArgs(Text::message(E_BAD_ZONE, vec![Arg::text("zone", name)]))
        })?;
        let instant = i64::try_from(now_ms)
            .ok()
            .and_then(|ms| jiff::Timestamp::from_millisecond(ms).ok())
            .ok_or_else(|| PluginError::BadArgs(Text::key(E_BAD_INSTANT)))?;
        let civil = instant.to_zoned(zone);
        return Ok((
            civil.year() as i64,
            civil.month() as u64,
            civil.day() as u64,
            civil.hour() as u64,
            civil.minute() as u64,
        ));
    }
    let civil = locale.to_civil_millis(now_ms);
    let days = civil.div_euclid(86_400_000);
    let in_day = civil.rem_euclid(86_400_000) as u64;
    let (y, m, d) = civil_from_days(days);
    Ok((y, m, d, in_day / 3_600_000, (in_day % 3_600_000) / 60_000))
}

/// L'ora `hh:mm` nel ciclo dell'utente: `14:05` o `2:05 PM`.
pub fn format_time(hh: u64, mm: u64, cycle: HourCycle) -> String {
    match cycle {
        HourCycle::H23 => format!("{hh:02}:{mm:02}"),
        HourCycle::H12 => {
            let suffix = if hh < 12 { "AM" } else { "PM" };
            let h12 = match hh % 12 {
                0 => 12,
                h => h,
            };
            format!("{h12}:{mm:02} {suffix}")
        }
    }
}

/// Sostituisce in `src` ogni data e ogni ora del vocabolario, a cascata
/// (`{{datetime}}` prima di `{{date}}` e `{{time}}`), come hanno sempre fatto
/// i template. Ciò che non è una data o un'ora resta com'è.
pub fn expand_dates(src: &str, ctx: &Ctx) -> String {
    src.replace("{{datetime}}", &ctx.datetime)
        .replace("{{date}}", &ctx.date)
        .replace("{{time}}", &ctx.time)
        .replace("{{year}}", &ctx.year)
        .replace("{{month}}", &ctx.month)
        .replace("{{day}}", &ctx.day)
        .replace("{{hour}}", &ctx.hour)
        .replace("{{minute}}", &ctx.minute)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> Ctx {
        context_at(1_790_000_000_000, &Locale::default()).expect("contesto")
    }

    #[test]
    fn ogni_nome_del_vocabolario_ha_un_valore() {
        let ctx = ctx();
        for name in DATE_NAMES {
            let value = ctx.get(name).expect("nome del vocabolario");
            assert_eq!(expand_dates(&format!("{{{{{name}}}}}"), &ctx), value);
        }
        assert_eq!(ctx.get("title"), None);
        assert_eq!(ctx.get("random"), None);
    }

    #[test]
    fn cio_che_non_e_una_data_resta_testo() {
        assert_eq!(
            expand_dates("{{title}} {{ date }} {{date", &ctx()),
            "{{title}} {{ date }} {{date"
        );
    }
}
