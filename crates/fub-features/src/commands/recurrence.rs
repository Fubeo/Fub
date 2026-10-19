//! I compiti ricorrenti, con la scrittura del plugin Tasks di Obsidian.
//!
//! `- [ ] Annaffia 🔁 every week 📅 2026-10-19`: spuntarlo lascia la riga fatta
//! dov'è e scrive sopra di essa il compito successivo, con le date spostate di
//! un intervallo. La regola sta tutta nella riga, quindi un vault che arriva da
//! Obsidian continua a ricorrere qui, e viceversa.
//!
//! Le date che si spostano sono le tre che Tasks sposta: scadenza (`📅`),
//! programmata (`⏳`) e inizio (`🛫`). La data di riferimento è la scadenza, poi
//! la programmata, poi l'inizio; le altre si spostano dello stesso numero di
//! giorni, così la distanza fra loro resta quella scritta. Con `when done` il
//! riferimento nuovo si conta da oggi invece che dalla data scritta.
//!
//! Una regola che non si capisce non ricorre: il compito si spunta e basta,
//! come se la ricorrenza non ci fosse. Inventare un intervallo sarebbe peggio.

use fub_abi::locale::{civil_from_days, days_from_civil, days_in_month};

/// Il simbolo della ricorrenza.
const RECURS: char = '🔁';
/// Le date che la ricorrenza sposta, nell'ordine in cui fanno da riferimento.
const DATES: [char; 3] = ['📅', '⏳', '🛫'];
/// La data di completamento: il compito nuovo non è fatto, e non la porta.
const DONE: char = '✅';
/// I simboli con cui Tasks chiude un campo: la regola finisce al primo.
const FIELDS: [char; 13] = [
    '📅', '⏳', '🛫', '✅', '➕', '❌', '⏫', '🔼', '🔽', '⏬', '🔺', '🆔', '⛔',
];

/// Di quanto si va avanti.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Days(i64),
    Months(i64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Rule {
    step: Step,
    /// `when done`: il prossimo si conta da oggi, non dalla data scritta.
    from_today: bool,
}

/// La riga del compito successivo, o `None` se la riga non ricorre.
///
/// `line` è la riga del compito senza terminatore, ancora da spuntare; `today`
/// è il giorno civile dell'utente in giorni dall'epoca. La riga nuova è la
/// stessa con le date spostate e senza la data di completamento, quindi
/// conserva rientro, punto elenco, testo e ogni campo che qui non si capisce.
pub(super) fn next_line(line: &str, today: i64) -> Option<String> {
    let rule = rule_of(line)?;
    let dates = dates_of(line);
    let reference = DATES.iter().find_map(|sign| {
        dates
            .iter()
            .find(|(_, (s, _))| s == sign)
            .map(|(_, (_, day))| *day)
    })?;
    let base = if rule.from_today { today } else { reference };
    let delta = advance(base, rule.step)? - reference;
    let mut out = String::with_capacity(line.len());
    let mut rest = 0;
    for (at, (_, day)) in &dates {
        out.push_str(&line[rest..at.0]);
        out.push_str(&iso(day + delta));
        rest = at.1;
    }
    out.push_str(&line[rest..]);
    Some(without_done(&out))
}

/// La regola scritta dopo `🔁`, fino al campo successivo.
fn rule_of(line: &str) -> Option<Rule> {
    let start = line.find(RECURS)? + RECURS.len_utf8();
    let tail = &line[start..];
    let end = tail.find(|c| FIELDS.contains(&c)).unwrap_or(tail.len());
    let text = tail[..end].trim().to_ascii_lowercase();
    let mut words: Vec<&str> = text.split_whitespace().collect();
    let from_today = words.ends_with(&["when", "done"]);
    if from_today {
        words.truncate(words.len() - 2);
    }
    let mut words = words.as_slice();
    if let ["every" | "ogni", rest @ ..] = words {
        words = rest;
    } else {
        return None;
    }
    let (n, unit) = match words {
        [unit] => (1, *unit),
        [n, unit] => (n.parse::<i64>().ok().filter(|n| *n > 0)?, *unit),
        _ => return None,
    };
    let step = match unit {
        "day" | "days" | "giorno" | "giorni" => Step::Days(n),
        "week" | "weeks" | "settimana" | "settimane" => Step::Days(7 * n),
        "month" | "months" | "mese" | "mesi" => Step::Months(n),
        "year" | "years" | "anno" | "anni" => Step::Months(12 * n),
        _ => return None,
    };
    Some(Rule { step, from_today })
}

/// Le date spostabili della riga: dove sta la data `AAAA-MM-GG` (byte, fine
/// esclusa), il suo simbolo e il giorno che dice.
fn dates_of(line: &str) -> Vec<((usize, usize), (char, i64))> {
    let mut found = Vec::new();
    for (at, sign) in line.char_indices() {
        if !DATES.contains(&sign) {
            continue;
        }
        let after = at + sign.len_utf8();
        let skip = line[after..].len() - line[after..].trim_start().len();
        let start = after + skip;
        if let Some(day) = line.get(start..start + 10).and_then(day_of) {
            found.push(((start, start + 10), (sign, day)));
        }
    }
    found
}

/// `AAAA-MM-GG` in giorni dall'epoca, se è un giorno che esiste.
fn day_of(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u64> {
        let part = &text[r];
        if part.bytes().all(|b| b.is_ascii_digit()) {
            part.parse().ok()
        } else {
            None
        }
    };
    let (y, m, d) = (digits(0..4)?, digits(5..7)?, digits(8..10)?);
    if !(1..=12).contains(&m) || d == 0 || d > days_in_month(y as i64, m) {
        return None;
    }
    Some(days_from_civil(y as i64, m, d))
}

fn iso(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Un passo avanti da `day`. Un mese che non ha quel giorno si ferma al suo
/// ultimo: il 31 gennaio più un mese è il 28 (o il 29) febbraio.
fn advance(day: i64, step: Step) -> Option<i64> {
    match step {
        Step::Days(n) => day.checked_add(n),
        Step::Months(n) => {
            let (y, m, d) = civil_from_days(day);
            let index = y
                .checked_mul(12)?
                .checked_add(m as i64 - 1)?
                .checked_add(n)?;
            let (y, m) = (index.div_euclid(12), index.rem_euclid(12) as u64 + 1);
            Some(days_from_civil(y, m, d.min(days_in_month(y, m))))
        }
    }
}

/// La riga senza `✅ AAAA-MM-GG` e senza lo spazio che lo precedeva.
fn without_done(line: &str) -> String {
    let Some(at) = line.find(DONE) else {
        return line.to_string();
    };
    let after = at + DONE.len_utf8();
    let skip = line[after..].len() - line[after..].trim_start().len();
    let end = (after + skip + 10).min(line.len());
    let end = if line.get(after + skip..end).and_then(day_of).is_some() {
        end
    } else {
        after
    };
    let head = line[..at].trim_end();
    format!("{head}{}", &line[end..])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> i64 {
        day_of("2026-10-19").unwrap()
    }

    #[test]
    fn a_weekly_task_moves_its_due_date_one_week_on() {
        assert_eq!(
            next_line("- [ ] Annaffia 🔁 every week 📅 2026-10-19", today()).as_deref(),
            Some("- [ ] Annaffia 🔁 every week 📅 2026-10-26")
        );
    }

    #[test]
    fn every_date_keeps_its_distance_from_the_due_date() {
        assert_eq!(
            next_line(
                "  * [ ] Bolletta 🔁 every 2 months 🛫 2026-01-25 📅 2026-01-31",
                today()
            )
            .as_deref(),
            Some("  * [ ] Bolletta 🔁 every 2 months 🛫 2026-03-25 📅 2026-03-31"),
            "the due date leads; the start date moves by the same days"
        );
    }

    #[test]
    fn a_month_without_the_day_stops_at_its_last() {
        assert_eq!(
            next_line("- [ ] Affitto 🔁 every month 📅 2026-01-31", today()).as_deref(),
            Some("- [ ] Affitto 🔁 every month 📅 2026-02-28")
        );
        assert_eq!(
            next_line("- [ ] Auguri 🔁 every year ⏳ 2028-02-29", today()).as_deref(),
            Some("- [ ] Auguri 🔁 every year ⏳ 2029-02-28")
        );
    }

    #[test]
    fn when_done_counts_from_today() {
        assert_eq!(
            next_line(
                "- [ ] Taglia i capelli 🔁 every 3 weeks when done 📅 2026-09-01",
                today()
            )
            .as_deref(),
            Some("- [ ] Taglia i capelli 🔁 every 3 weeks when done 📅 2026-11-09")
        );
    }

    #[test]
    fn the_italian_rule_reads_the_same() {
        assert_eq!(
            next_line("- [ ] Spesa 🔁 ogni 2 giorni 📅 2026-10-30", today()).as_deref(),
            Some("- [ ] Spesa 🔁 ogni 2 giorni 📅 2026-11-01")
        );
    }

    #[test]
    fn the_next_task_is_not_done_yet() {
        assert_eq!(
            next_line(
                "- [ ] Report 🔁 every day 📅 2026-10-19 ✅ 2026-10-18 #lavoro",
                today()
            )
            .as_deref(),
            Some("- [ ] Report 🔁 every day 📅 2026-10-20 #lavoro")
        );
    }

    #[test]
    fn without_a_rule_or_a_date_nothing_recurs() {
        for line in [
            "- [ ] Senza ricorrenza 📅 2026-10-19",
            "- [ ] Senza data 🔁 every week",
            "- [ ] Regola strana 🔁 every blue moon 📅 2026-10-19",
            "- [ ] Zero 🔁 every 0 days 📅 2026-10-19",
            "- [ ] Data finta 🔁 every day 📅 2026-02-30",
        ] {
            assert_eq!(next_line(line, today()), None, "{line}");
        }
    }
}
