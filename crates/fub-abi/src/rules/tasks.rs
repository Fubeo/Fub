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
//! Sul **primo paragrafo** della voce, senza la sintassi ([`task_text`]): il
//! testo dentro `code` e l'etichetta di un link contano, la destinazione di un
//! link no, un tag conta col suo `#`, un a capo morbido è uno spazio. Le
//! sottovoci non sono il compito.
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
//! [`TaskDue::from`]..[`TaskDue::to`] è il tratto che la scadenza occupa nel
//! testo, segno compreso: è ciò che una superficie disegna come pastiglia, e
//! ciò che una vista toglie dal testo quando la data la mostra a parte.

use crate::locale::{civil_from_days, days_from_civil, days_in_month};
use crate::model::{Block, Inline};

/// Il segno che introduce la scadenza.
pub const DUE_MARK: &str = "📅";

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
            Inline::Link {
                label: Some(label), ..
            } => push_plain(label, out),
            Inline::TagRef { name, .. } => {
                out.push('#');
                out.push_str(name);
            }
            Inline::SoftBreak | Inline::HardBreak => out.push(' '),
            Inline::Link { label: None, .. } | Inline::Custom { .. } => {}
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
