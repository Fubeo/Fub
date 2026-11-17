//! **Quando scade un compito**: il testo di un compito e la data che porta.
//!
//! La scadenza la scrive il plugin Tasks di Obsidian: `📅 2026-10-19` nel
//! testo del compito. La leggono in tre: la ricerca (il campo dei `due:`), la
//! vista dei compiti (i gruppi e la pastiglia) e la superficie di scrittura (la
//! pastiglia nel testo, mentre si scrive). Finché la regola stava scritta in
//! ognuno, i tre davano tre risposte sulla stessa riga: la ricerca non guardava
//! il testo dentro `code` e accettava `2026-02-30`, la vista sì e no. Adesso è
//! una, e la gemella TypeScript (`rules/mirrored.ts`, `taskDue`) è legata a
//! questa dalla fixture di `rules_mirror.rs`.
//!
//! # Su quale testo
//!
//! Sul **primo paragrafo** della voce, righe che lo continuano comprese, senza
//! la sintassi ([`task_text`]): conta ciò che si legge. Il testo dentro `code`
//! e l'etichetta di un link contano, la destinazione no; un wikilink senza
//! alias conta con l'interno che mostra (`[[Mario]]` è «Mario», `[[Nota#Sez]]`
//! è «Nota#Sez»), con l'alias conta l'alias; un evidenziato conta col suo
//! testo; un'immagine, un embed, una formula, un commento e un richiamo di
//! nota non sono parole del compito; un tag conta col suo `#`; un a capo
//! morbido è uno spazio. Così
//! `📅 [[2026-10-19]]`, la forma che scrive chi collega le note del giorno, è
//! una scadenza che si legge. Le sottovoci non sono il compito.
//!
//! # La regola
//!
//! - Conta l'**ultima** `📅` del testo.
//! - Dopo il segno si saltano spazi e tabulazioni; i dieci caratteri che
//!   seguono devono avere la forma `AAAA-MM-GG` e non essere seguiti da
//!   un'altra cifra.
//! - Se hanno la forma ed esistono come giorno, sono la scadenza.
//! - Altrimenti la scadenza c'è ma **non si legge** ([`TaskDue::day`] è
//!   `None`): una `📅` scritta male non è un compito senza data, è un compito
//!   con un refuso, e chi lo mostra deve poterlo dire.
//!
//! # Quanto preme
//!
//! Una scadenza leggibile di un compito aperto è **scaduta** se cade prima di
//! oggi, **vicina** se cade oggi o nei sei giorni seguenti (meno di
//! [`NEAR_DAYS`] giorni da oggi), **lontana** dopo ([`due_urgency`]). Scaduta
//! si mostra rossa, vicina arancio, dovunque: la pastiglia nel testo e quella
//! della vista dicono la stessa cosa della stessa data.
//!
//! [`TaskDue::from`]..[`TaskDue::to`] è il tratto che la scadenza occupa nel
//! testo, segno compreso: è ciò che una superficie disegna come pastiglia, e
//! ciò che una vista toglie dal testo quando la data la mostra a parte.
//!
//! # Il promemoria
//!
//! Il promemoria lo scrive il plugin Reminder di Obsidian, nella forma che
//! accanto al plugin Tasks si legge: `⏰ 2026-11-13 09:00` nel testo del
//! compito. La regola è la gemella di quella della scadenza, sullo stesso
//! testo ([`task_reminder`]):
//!
//! - conta l'**ultimo** `⏰` del testo;
//! - dopo il segno si saltano spazi e tabulazioni, poi una data `AAAA-MM-GG`
//!   che esiste e, separata da spazi o tabulazioni, un'ora `HH:MM` (da `00:00`
//!   a `23:59`); né la data né l'ora sono seguite da un'altra cifra;
//! - senza ora il promemoria suona alle nove ([`DEFAULT_REMINDER_MINUTE`]);
//! - altrimenti il promemoria c'è ma **non si legge** ([`TaskReminder::minute`]
//!   è `None`), come una `📅` scritta male: anche un'ora che non esiste
//!   (`25:00`) è un refuso, non un promemoria delle nove.
//!
//! L'ora è **l'ora del muro**, senza fuso: «alle nove» vuol dire le nove dove
//! si trova chi legge quando arrivano, anche se nel frattempo ha cambiato fuso
//! o è scattata l'ora legale. Per questo il promemoria diventa un minuto
//! civile ([`TaskReminder::minute`], minuti dall'epoca dell'ora del muro) e si
//! confronta con l'ora del muro di adesso ([`civil_minute`]), mai con un
//! istante UTC calcolato una volta: l'offset di oggi applicato a una data di
//! marzo sbaglierebbe di un'ora dopo il cambio.

use crate::locale::{civil_from_days, days_from_civil, days_in_month};
use crate::model::{Block, Inline, LinkTarget};

/// Il segno che introduce la scadenza.
pub const DUE_MARK: &str = "📅";

/// Quanti giorni da oggi una scadenza resta vicina: oggi più i sei seguenti.
pub const NEAR_DAYS: i64 = 7;

/// Quanto preme una scadenza leggibile.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DueUrgency {
    /// Il giorno è passato.
    Overdue,
    /// Oggi o entro [`NEAR_DAYS`] giorni.
    Near,
    /// Più in là.
    Later,
}

/// Quanto preme la scadenza `day` rispetto a `today` (giorni dall'epoca). Chi
/// la mostra la guarda solo per un compito aperto: uno fatto non ha più
/// fretta.
pub fn due_urgency(day: i64, today: i64) -> DueUrgency {
    if day < today {
        DueUrgency::Overdue
    } else if day < today + NEAR_DAYS {
        DueUrgency::Near
    } else {
        DueUrgency::Later
    }
}

/// La scadenza trovata in un testo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaskDue {
    /// Dove comincia il segno, in byte del testo.
    pub from: usize,
    /// Dove finisce la data, o la parola che doveva esserlo; il segno da solo,
    /// se dopo non c'è niente.
    pub to: usize,
    /// Il giorno, in giorni dall'epoca, se la data esiste.
    pub day: Option<i64>,
}

impl TaskDue {
    /// La data in forma `AAAA-MM-GG`, se si legge.
    pub fn iso(&self) -> Option<String> {
        self.day.map(iso_day)
    }
}

/// La scadenza di un testo, se ha una `📅`. Vedi il modulo per la regola.
pub fn task_due(text: &str) -> Option<TaskDue> {
    let from = text.rfind(DUE_MARK)?;
    let mark_end = from + DUE_MARK.len();
    let rest = &text[mark_end..];
    let start = mark_end + (rest.len() - rest.trim_start_matches([' ', '\t']).len());
    let after = &text[start..];
    if let Some(date) = after.get(..10) {
        let next_is_digit = after[10..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit());
        if shaped(date) && !next_is_digit {
            return Some(TaskDue {
                from,
                to: start + 10,
                day: civil_day(date),
            });
        }
    }
    let word = after.find([' ', '\t']).unwrap_or(after.len());
    Some(TaskDue {
        from,
        to: if word == 0 { mark_end } else { start + word },
        day: None,
    })
}

/// Il segno che introduce il promemoria.
pub const REMINDER_MARK: &str = "⏰";

/// Il minuto del giorno di un promemoria scritto senza ora: le nove.
pub const DEFAULT_REMINDER_MINUTE: i64 = 9 * 60;

/// I minuti di un giorno.
const DAY_MINUTES: i64 = 24 * 60;

/// Un minuto, in millisecondi.
const MINUTE_MS: i64 = 60_000;

/// Il promemoria trovato in un testo.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaskReminder {
    /// Dove comincia il segno, in byte del testo.
    pub from: usize,
    /// Dove finisce l'ora, o la data se l'ora non c'è, o la parola che doveva
    /// esserlo; il segno da solo, se dopo non c'è niente.
    pub to: usize,
    /// Il minuto civile, in minuti dall'epoca dell'ora del muro, se si legge.
    pub minute: Option<i64>,
    /// L'ora era scritta: senza, il promemoria suona alle nove.
    pub timed: bool,
}

impl TaskReminder {
    /// Il promemoria nella forma `AAAA-MM-GG HH:MM`, se si legge.
    pub fn text(&self) -> Option<String> {
        self.minute.map(reminder_text)
    }
}

/// Il promemoria di un testo, se ha un `⏰`. Vedi il modulo per la regola.
pub fn task_reminder(text: &str) -> Option<TaskReminder> {
    let from = text.rfind(REMINDER_MARK)?;
    let mark_end = from + REMINDER_MARK.len();
    let start = skip_blanks(text, mark_end);
    let unreadable = |at: usize| {
        let rest = &text[at..];
        let word = rest.find([' ', '\t']).unwrap_or(rest.len());
        TaskReminder {
            from,
            // Una parola vuota succede solo subito dopo il segno: il tratto è
            // il segno da solo, come per la scadenza.
            to: if word == 0 { mark_end } else { at + word },
            minute: None,
            timed: false,
        }
    };
    let after = &text[start..];
    let day = after
        .get(..10)
        .filter(|date| shaped(date) && !next_is_digit(&after[10..]))
        .and_then(civil_day);
    let Some(day) = day else {
        return Some(unreadable(start));
    };
    let date_end = start + 10;
    // L'ora è facoltativa, ma ciò che dopo la data comincia con una cifra è
    // un'ora o un refuso: `⏰ 2026-11-13 25:00` non suona alle nove.
    let time_start = skip_blanks(text, date_end);
    if time_start == date_end || !next_is_digit(&text[time_start..]) {
        return Some(TaskReminder {
            from,
            to: date_end,
            minute: Some(day * DAY_MINUTES + DEFAULT_REMINDER_MINUTE),
            timed: false,
        });
    }
    let rest = &text[time_start..];
    match rest.get(..5).and_then(clock_minute) {
        Some(minute) if !next_is_digit(&rest[5..]) => Some(TaskReminder {
            from,
            to: time_start + 5,
            minute: Some(day * DAY_MINUTES + minute),
            timed: true,
        }),
        _ => Some(unreadable(time_start)),
    }
}

/// `AAAA-MM-GG HH:MM`, o `AAAA-MM-GG` per le nove, in minuti civili
/// dall'epoca: è la forma con cui un promemoria si scrive e si chiede.
pub fn reminder_minute(text: &str) -> Option<i64> {
    let day = civil_day(text.get(..10)?)?;
    let rest = &text[10..];
    if rest.is_empty() {
        return Some(day * DAY_MINUTES + DEFAULT_REMINDER_MINUTE);
    }
    let time = rest.strip_prefix(' ')?;
    Some(day * DAY_MINUTES + clock_minute(time)?)
}

/// Un minuto civile dall'epoca nella forma `AAAA-MM-GG HH:MM`.
pub fn reminder_text(minute: i64) -> String {
    let day = minute.div_euclid(DAY_MINUTES);
    let of_day = minute.rem_euclid(DAY_MINUTES);
    format!("{} {:02}:{:02}", iso_day(day), of_day / 60, of_day % 60)
}

/// L'ora del muro di adesso, in minuti dall'epoca: l'istante UTC spostato
/// dell'offset **di adesso** di chi guarda.
///
/// Con un promemoria si confronta questo, ricalcolato a ogni domanda: un
/// cambio di fuso o l'ora legale spostano l'ora del muro, e il promemoria delle
/// nove suona alle nove nuove.
pub fn civil_minute(utc_offset_minutes: i16, utc_millis: u64) -> i64 {
    let civil =
        i64::try_from(utc_millis).unwrap_or(i64::MAX) + i64::from(utc_offset_minutes) * MINUTE_MS;
    civil.div_euclid(MINUTE_MS)
}

/// `HH:MM` in minuti del giorno, da `00:00` a `23:59`.
fn clock_minute(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return None;
    }
    let digits = [bytes[0], bytes[1], bytes[3], bytes[4]];
    if !digits.iter().all(u8::is_ascii_digit) {
        return None;
    }
    let number = |high: u8, low: u8| i64::from(high - b'0') * 10 + i64::from(low - b'0');
    let (hour, minute) = (number(digits[0], digits[1]), number(digits[2], digits[3]));
    (hour < 24 && minute < 60).then_some(hour * 60 + minute)
}

/// Dove finiscono gli spazi e le tabulazioni che cominciano a `at`.
fn skip_blanks(text: &str, at: usize) -> usize {
    let rest = &text[at..];
    at + (rest.len() - rest.trim_start_matches([' ', '\t']).len())
}

/// Il testo comincia con una cifra.
fn next_is_digit(rest: &str) -> bool {
    rest.chars().next().is_some_and(|c| c.is_ascii_digit())
}

/// `AAAA-MM-GG` come forma: cifre e trattini al loro posto.
fn shaped(date: &str) -> bool {
    date.len() == 10
        && date.bytes().enumerate().all(|(at, c)| match at {
            4 | 7 => c == b'-',
            _ => c.is_ascii_digit(),
        })
}

/// `AAAA-MM-GG` in giorni dall'epoca, se è un giorno che esiste.
pub fn civil_day(text: &str) -> Option<i64> {
    if !shaped(text) {
        return None;
    }
    let number = |range: std::ops::Range<usize>| text.get(range)?.parse::<u64>().ok();
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year as i64, month) {
        return None;
    }
    Some(days_from_civil(year as i64, month, day))
}

/// Un giorno dall'epoca in forma `AAAA-MM-GG`.
pub fn iso_day(day: i64) -> String {
    let (year, month, day) = civil_from_days(day);
    format!("{year:04}-{month:02}-{day:02}")
}

/// Il testo di un compito: il primo paragrafo della sua voce, senza la
/// sintassi. Una voce che non comincia con un paragrafo non ha testo.
pub fn task_text(blocks: &[Block]) -> String {
    match blocks.first() {
        Some(Block::Paragraph { inlines, .. }) => plain_text(inlines),
        _ => String::new(),
    }
}

/// Il testo leggibile di una riga di inline: la parte che l'utente legge.
pub fn plain_text(inlines: &[Inline]) -> String {
    let mut out = String::new();
    push_plain(inlines, &mut out);
    out.trim().to_string()
}

fn push_plain(inlines: &[Inline], out: &mut String) {
    for inline in inlines {
        match inline {
            Inline::Text(s) | Inline::Code(s) => out.push_str(s),
            Inline::Emph(inner)
            | Inline::Strong(inner)
            | Inline::Superscript(inner)
            | Inline::Subscript(inner)
            | Inline::Strikethrough(inner) => push_plain(inner, out),
            // Un'immagine o un embed si vedono per ciò che incorporano, non
            // come testo: il loro alias è una didascalia o una misura.
            Inline::Link { embed: true, .. } => {}
            Inline::Link {
                label: Some(label), ..
            } => push_plain(label, out),
            // Senza alias, di un wikilink si legge l'interno; di un link
            // Markdown senza etichetta (`[](url)`) non si legge niente.
            Inline::Link {
                label: None,
                target,
                ..
            } => {
                if let LinkTarget::Wiki { .. } = target {
                    out.push_str(&target.wiki_inner().unwrap_or_default());
                }
            }
            Inline::TagRef { name, .. } => {
                out.push('#');
                out.push_str(name);
            }
            Inline::SoftBreak | Inline::HardBreak => out.push(' '),
            // Un evidenziato si legge; una formula, un commento o un richiamo
            // di nota no: non sono parole del compito.
            Inline::Custom {
                custom_kind, attrs, ..
            } if custom_kind == crate::model::custom_kind::HIGHLIGHT => {
                out.push_str(attrs["text"].as_str().unwrap_or_default());
            }
            Inline::Custom { .. } => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(text: &str) -> Option<(&str, Option<String>)> {
        task_due(text).map(|due| (&text[due.from..due.to], due.iso()))
    }

    #[test]
    fn the_due_date_is_the_last_mark_and_a_wrong_one_does_not_read() {
        assert_eq!(
            span("Pagare 📅 2026-10-19"),
            Some(("📅 2026-10-19", Some("2026-10-19".into())))
        );
        assert_eq!(
            span("Ricorda 📅 2026-10-01 poi 📅 2026-10-19 ✅"),
            Some(("📅 2026-10-19", Some("2026-10-19".into()))),
            "conta l'ultima"
        );
        assert_eq!(span("Senza scadenza"), None);
        assert_eq!(span("Refuso 📅 2026-02-30"), Some(("📅 2026-02-30", None)));
        assert_eq!(span("Vuoto 📅"), Some(("📅", None)));
        assert_eq!(span("Parola 📅 domani e poi"), Some(("📅 domani", None)));
        assert_eq!(
            span("Attaccata 📅2026-10-19, con la virgola"),
            Some(("📅2026-10-19", Some("2026-10-19".into())))
        );
        assert_eq!(
            span("Troppe cifre 📅 2026-10-199"),
            Some(("📅 2026-10-199", None))
        );
    }

    fn reminder(text: &str) -> Option<(&str, Option<String>, bool)> {
        task_reminder(text).map(|r| (&text[r.from..r.to], r.text(), r.timed))
    }

    #[test]
    fn the_reminder_is_the_last_mark_with_its_wall_clock_time() {
        assert_eq!(
            reminder("Chiamare ⏰ 2026-11-13 09:30"),
            Some(("⏰ 2026-11-13 09:30", Some("2026-11-13 09:30".into()), true))
        );
        assert_eq!(
            reminder("Senza ora ⏰ 2026-11-13 e poi"),
            Some(("⏰ 2026-11-13", Some("2026-11-13 09:00".into()), false)),
            "senza ora suona alle nove"
        );
        assert_eq!(
            reminder("Due ⏰ 2026-11-01 08:00 poi ⏰ 2026-11-13 18:45"),
            Some(("⏰ 2026-11-13 18:45", Some("2026-11-13 18:45".into()), true)),
            "conta l'ultimo"
        );
        assert_eq!(
            reminder("Tab ⏰\t2026-11-13\t07:05 📅 2026-11-14"),
            Some((
                "⏰\t2026-11-13\t07:05",
                Some("2026-11-13 07:05".into()),
                true
            ))
        );
        assert_eq!(
            reminder("Mezzanotte ⏰ 2026-11-13 00:00"),
            Some(("⏰ 2026-11-13 00:00", Some("2026-11-13 00:00".into()), true))
        );
        assert_eq!(reminder("Niente"), None);
        assert_eq!(reminder("Vuoto ⏰"), Some(("⏰", None, false)));
        assert_eq!(
            reminder("Giorno ⏰ 2026-02-30 09:00"),
            Some(("⏰ 2026-02-30", None, false))
        );
        assert_eq!(
            reminder("Ora ⏰ 2026-11-13 25:00 dopo"),
            Some(("⏰ 2026-11-13 25:00", None, false)),
            "un'ora che non esiste è un refuso, non le nove"
        );
        assert_eq!(
            reminder("Minuti ⏰ 2026-11-13 09:60"),
            Some(("⏰ 2026-11-13 09:60", None, false))
        );
        assert_eq!(
            reminder("Cifre ⏰ 2026-11-13 09:000"),
            Some(("⏰ 2026-11-13 09:000", None, false))
        );
        assert_eq!(
            reminder("Parola ⏰ domani"),
            Some(("⏰ domani", None, false))
        );
    }

    #[test]
    fn the_reminder_text_goes_and_comes_back() {
        for text in ["2026-11-13 09:00", "1969-12-31 23:59", "2028-02-29 00:01"] {
            let minute = reminder_minute(text).expect(text);
            assert_eq!(reminder_text(minute), text);
        }
        assert_eq!(
            reminder_minute("2026-11-13"),
            reminder_minute("2026-11-13 09:00"),
            "senza ora sono le nove"
        );
        for bad in [
            "2026-11-13 9:00",
            "2026-11-13  09:00",
            "2026-11-13T09:00",
            "2026-11-13 24:00",
            "",
            "domani",
        ] {
            assert_eq!(reminder_minute(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_wall_clock_now_follows_the_offset_of_now() {
        let nine_utc = (days_from_civil(2026, 11, 13) as u64 * 1_440 + 9 * 60) * 60_000;
        let at = |offset| reminder_text(civil_minute(offset, nine_utc));
        assert_eq!(at(0), "2026-11-13 09:00");
        assert_eq!(at(60), "2026-11-13 10:00", "Roma d'inverno");
        assert_eq!(at(120), "2026-11-13 11:00", "Roma d'estate");
        assert_eq!(at(-600), "2026-11-12 23:00", "Honolulu: il giorno prima");
        assert_eq!(at(345), "2026-11-13 14:45", "Kathmandu");
    }

    #[test]
    fn a_date_reads_only_when_the_day_exists() {
        assert!(civil_day("2028-02-29").is_some(), "bisestile");
        for bad in [
            "2026-02-30",
            "2027-02-29",
            "2026-13-01",
            "2026-00-10",
            "2026-10-00",
            "2026-1O-19",
            "",
        ] {
            assert_eq!(civil_day(bad), None, "{bad}");
        }
        let day = civil_day("2026-10-19").expect("esiste");
        assert_eq!(iso_day(day), "2026-10-19");
    }

    #[test]
    fn overdue_is_before_today_and_near_is_today_or_the_six_days_after() {
        let today = civil_day("2026-11-14").expect("esiste");
        assert_eq!(
            due_urgency(today - 30, today),
            DueUrgency::Overdue,
            "passata"
        );
        assert_eq!(due_urgency(today - 1, today), DueUrgency::Overdue, "ieri");
        assert_eq!(due_urgency(today, today), DueUrgency::Near, "oggi");
        assert_eq!(
            due_urgency(today + 4, today),
            DueUrgency::Near,
            "fra quattro giorni"
        );
        assert_eq!(
            due_urgency(today + 6, today),
            DueUrgency::Near,
            "fra sei giorni"
        );
        assert_eq!(
            due_urgency(today + 7, today),
            DueUrgency::Later,
            "fra sette giorni"
        );
        assert_eq!(
            due_urgency(today + 10, today),
            DueUrgency::Later,
            "fra dieci giorni"
        );
    }

    fn wiki(page: &str, label: Option<&str>, embed: bool) -> Inline {
        Inline::Link {
            target: LinkTarget::wiki(page),
            label: label.map(|text| vec![Inline::Text(text.into())]),
            embed,
            span: crate::model::Span::new(0, 1),
        }
    }

    #[test]
    fn a_wikilink_reads_as_what_it_shows() {
        let inlines = vec![
            Inline::Text("Chiama ".into()),
            wiki("Mario", None, false),
            Inline::Text(" e ".into()),
            wiki("Persone/Anna", Some("Anna"), false),
            Inline::Text(" ".into()),
            wiki("foto.png", None, true),
            Inline::Text(" 📅 ".into()),
            wiki("2026-10-19", None, false),
        ];
        let text = plain_text(&inlines);
        assert_eq!(text, "Chiama Mario e Anna  📅 2026-10-19");
        assert_eq!(
            task_due(&text).and_then(|due| due.iso()).as_deref(),
            Some("2026-10-19"),
            "la data del giorno collegata è una scadenza che si legge"
        );
    }

    #[test]
    fn the_text_is_the_words_without_the_syntax() {
        let inlines = vec![
            Inline::Strong(vec![Inline::Text("Pagare".into())]),
            Inline::Text(" la ".into()),
            Inline::Code("bolletta".into()),
            Inline::Text(" ".into()),
            Inline::TagRef {
                name: "casa".into(),
                span: crate::model::Span::new(0, 5),
            },
            Inline::SoftBreak,
            Inline::Text("📅 ".into()),
            Inline::Code("2026-10-19".into()),
        ];
        let text = plain_text(&inlines);
        assert_eq!(text, "Pagare la bolletta #casa 📅 2026-10-19");
        assert_eq!(
            task_due(&text).and_then(|due| due.iso()).as_deref(),
            Some("2026-10-19")
        );
    }
}
