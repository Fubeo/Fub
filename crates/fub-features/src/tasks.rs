//! I compiti del vault come vista: i compiti aperti di tutte le note, raggruppati
//! per scadenza, con la spunta che passa dal comando di oggi.
//!
//! # Chi dice quali note, e chi quali compiti
//!
//! La vista non tiene un indice suo. Chiede a `query_index` le note che hanno
//! almeno un compito aperto (la foglia `task:todo`, che risponde l'indice di
//! ricerca), e per ciascuna legge il modello con `read_model`: è il modello che
//! dice quali compiti ci sono, dove stanno e che testo hanno. L'indice dice
//! *quali note*, non *quali compiti*: una nota può averne di scaduti e di futuri.
//! Ciò che la vista disegna lo rilegge a ogni giro, e la sua dichiarazione di
//! interesse è l'indice che cambia (`IndexUpdated` e `BatchEnded`).
//!
//! # I quattro gruppi
//!
//! Il giorno è quello di chi guarda: l'orologio del vault letto col fuso e col
//! primo giorno della settimana di [`HostEnv::user_locale`], quindi la stessa
//! macchina dà la stessa risposta a ogni disegno e cambia risposta a mezzanotte
//! del suo fuso, non di quello del vault.
//!
//! - **Scaduti**: la scadenza è prima di oggi.
//! - **Questa settimana**: da oggi all'ultimo giorno della settimana, che inizia
//!   il primo giorno della settimana del locale.
//! - **Più avanti**: la scadenza è dopo la fine di questa settimana.
//! - **Senza data**: nessuna scadenza, o una che non è una data (`📅 2026-02-30`):
//!   quest'ultima si vede con la sua pastiglia, perché un compito non sparisce
//!   per un refuso nella data.
//!
//! La scadenza è la data dopo l'ultimo `📅`, come la scrive il plugin Tasks e
//! come la legge la ricerca. Le date ricorrenti (`🔁`) non hanno un trattamento
//! a parte: la riga di oggi porta la sua scadenza, e spuntarla fa nascere la
//! successiva con il comando che ricorre già.
//!
//! # La spunta
//!
//! Il payload di ogni compito porta dove stava (il byte del marcatore), il suo
//! simbolo e il suo testo. Chi spunta rilegge la nota e controlla che in quella
//! posizione ci sia ancora lo stesso compito: se la nota è cambiata sotto, la
//! vista si ridisegna e non spunta niente. Poi chiama `note.task.toggle` con la
//! posizione, e il comando scrive nella nota d'origine con la sua revisione.
//!
//! # I tetti
//!
//! La vista legge al più [`READ_LIMIT`] compiti e ne disegna al più
//! [`SHOW_LIMIT`], nell'ordine dei gruppi. Quando taglia lo dice: un vault con
//! diecimila compiti non è una lista da scorrere, ed è meglio una lista corta
//! che dice quanto manca che una lunga che si blocca al disegno.

use fub_abi::error::PluginError;
use fub_abi::event::{EventKind, EventMask};
use fub_abi::locale::{civil_from_days, days_from_civil, days_in_month, Weekday};
use fub_abi::model::{Block, DocId, DocumentModel, Inline};
use fub_abi::query::{QueryExpr, QueryPredicate, TaskStatus};
use fub_abi::session::ContextMask;
use fub_abi::text::{Arg, StringCatalog, Text};
use fub_abi::traits::{
    Excerpts, HostApi, IndexQuery, PropertySelect, ReadApi, ViewInstance, ViewInterests,
    ViewProvider, ViewSpec, ViewSurface,
};
use fub_abi::ui::{ActionRef, Intent, UiAction, UiKind, UiNode, ViewUpdate};

/// Id del provider (spazio dati e registrazione).
pub const TASKS_ID: &str = "fub.tasks";
/// Id della `ViewSpec`: è ciò con cui la shell chiede questa vista al kernel.
pub const TASKS_VIEW: &str = "tasks";

/// Il comando del registro che spunta un compito (`commands/tasks.rs`).
///
/// È una stringa e non l'import di [`crate::commands`], per la stessa ragione di
/// `trash.rs`: l'id di un comando è un nome del registro, cioè ciò che scriverebbe
/// un plugin di terzi. `tests/tasks_e2e.rs` lo cerca fra i comandi registrati.
const NOTE_TASK_TOGGLE: &str = "note.task.toggle";

/// Quanti compiti la vista legge al più. Oltre, il vault ne ha di più e la vista lo dice.
pub const READ_LIMIT: usize = 10_000;
/// Quanti compiti la vista disegna al più, nell'ordine dei gruppi.
pub const SHOW_LIMIT: usize = 300;

/// Un giorno, in millisecondi.
const DAY_MS: i64 = 86_400_000;
/// Il simbolo che introduce la scadenza.
const DUE_MARK: &str = "📅";

/// Le azioni che la vista riceve dai suoi nodi.
const OPEN: &str = "open";
const TOGGLE: &str = "toggle";

/// Le chiavi del payload di un compito.
const DOC: &str = "doc";
const AT: &str = "at";
const SYMBOL: &str = "symbol";
const TEXT: &str = "text";

const VIEW_TITLE: &str = "view_title";
const OVERDUE: &str = "overdue";
const THIS_WEEK: &str = "this_week";
const LATER: &str = "later";
const NO_DATE: &str = "no_date";
const EMPTY: &str = "empty";
const SHOWN: &str = "shown";
const SHOWN_MANY: &str = "shown_many";
const UNREADABLE_DATE: &str = "unreadable_date";
const UNREAD_NOTES: &str = "unread_notes";
const NO_INDEX: &str = "no_index";
const QUERY_FAILED: &str = "query_failed";
const CHANGED: &str = "changed";
const READ_ONLY: &str = "read_only";
const TOGGLE_FAILED: &str = "toggle_failed";

/// Le stringhe dei compiti. Vedi [`crate::backlinks::catalog`] per il perché stiano
/// nel componente e non nella shell.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Compiti")
            .with(OVERDUE, "Scaduti")
            .with(THIS_WEEK, "Questa settimana")
            .with(LATER, "Più avanti")
            .with(NO_DATE, "Senza data")
            .with(EMPTY, "Nessun compito aperto nel vault.")
            .with(SHOWN, "Mostro {shown} compiti su {total}.")
            .with(
                SHOWN_MANY,
                "Mostro {shown} compiti: il vault ne ha più di {total}. Restringi con la ricerca.",
            )
            .with(UNREADABLE_DATE, "Data non leggibile")
            .with(UNREAD_NOTES, "{count} note non si sono lette.")
            .with(
                NO_INDEX,
                "Il vault non ha un indice di ricerca attivo: i compiti non si leggono.",
            )
            .with(QUERY_FAILED, "Non riesco a leggere i compiti del vault.")
            .with(
                CHANGED,
                "Il compito è cambiato nel frattempo: l'ho riletto, controlla e riprova.",
            )
            .with(READ_ONLY, "Non posso spuntarlo: la nota è in sola lettura.")
            .with(TOGGLE_FAILED, "Non ho spuntato il compito."),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Tasks")
            .with(OVERDUE, "Overdue")
            .with(THIS_WEEK, "This week")
            .with(LATER, "Later")
            .with(NO_DATE, "No date")
            .with(EMPTY, "No open tasks in the vault.")
            .with(SHOWN, "Showing {shown} tasks out of {total}.")
            .with(
                SHOWN_MANY,
                "Showing {shown} tasks: the vault has more than {total}. Narrow it with search.",
            )
            .with(UNREADABLE_DATE, "Unreadable date")
            .with(UNREAD_NOTES, "{count} notes could not be read.")
            .with(
                NO_INDEX,
                "The vault has no search index running: tasks cannot be read.",
            )
            .with(QUERY_FAILED, "Could not read the tasks of the vault.")
            .with(
                CHANGED,
                "The task changed in the meantime: it has been read again, check it and retry.",
            )
            .with(READ_ONLY, "Cannot check it: the note is read-only.")
            .with(TOGGLE_FAILED, "Could not check the task."),
    ]
}

/// La vista dei compiti.
///
/// **Senza campi**, come il cestino: non ha stato proprio. Tutto ciò che disegna
/// lo rilegge, e una spunta si fa con un comando del registro.
pub struct TasksView;

impl ViewProvider for TasksView {
    fn views(&self) -> Vec<ViewSpec> {
        // Nella colonna dell'ispettore e chiusa di suo: si apre quando qualcuno la
        // chiede, come le altre viste dell'ispettore.
        vec![
            ViewSpec::new(TASKS_VIEW, Text::key(VIEW_TITLE), ViewSurface::RightSidebar)
                .with_icon("tasks")
                .ordered(3),
        ]
    }

    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Un compito nasce, si spunta o si sposta quando una nota si salva: è
            // l'indice che lo dice, e il lotto che lo chiude fa un ridisegno solo.
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            // Quali compiti ci sono non dipende da quale nota si guarda.
            follows: ContextMask::default(),
        }
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host, None)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            OPEN => match action.payload.get(DOC).and_then(|v| v.as_str()) {
                Some(doc) => Ok(ViewUpdate::Navigate {
                    doc_id: doc.to_string(),
                }),
                None => Ok(ViewUpdate::None),
            },
            TOGGLE => toggle(host, &action.payload),
            _ => Ok(ViewUpdate::None),
        }
    }
}

// ---------------------------------------------------------------------------
// Il dato: i compiti di una nota
// ---------------------------------------------------------------------------

/// Un compito come lo legge la vista.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Task {
    doc: DocId,
    /// Il byte del marcatore nel file: è la posizione che `note.task.toggle` vuole.
    at: usize,
    /// Il simbolo fra le parentesi; `None` è la casella vuota.
    symbol: Option<char>,
    /// `[x]` o `[X]`: un compito fatto non è aperto.
    checked: bool,
    /// Il testo della prima riga, senza il marcatore.
    text: String,
    due: Due,
}

/// La scadenza di un compito.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Due {
    /// Nessuna `📅`.
    None,
    /// Una data che esiste, in giorni dall'epoca.
    Day(i64),
    /// Una `📅` seguita da qualcosa che non è una data che esiste.
    Unreadable,
}

/// Tutti i compiti di un modello, aperti e fatti, in qualunque punto dell'albero.
///
/// Il cammino è quello della ricerca (`task_states`): liste annidate, citazioni e
/// blocchi custom. Il testo è quello della prima riga della voce, e la scadenza
/// quella che il testo porta.
fn tasks_of(model: &DocumentModel, doc: &DocId) -> Vec<Task> {
    let mut found = Vec::new();
    let mut pending: Vec<&Block> = model.body.iter().collect();
    while let Some(block) = pending.pop() {
        match block {
            Block::List { items, .. } => {
                for item in items {
                    if let Some(marker) = item.task {
                        let text = match item.blocks.first() {
                            Some(Block::Paragraph { inlines, .. }) => plain(inlines),
                            _ => String::new(),
                        };
                        found.push(Task {
                            doc: doc.clone(),
                            at: marker.span.start,
                            symbol: marker.symbol,
                            checked: marker.checked(),
                            due: due_of(&text),
                            text,
                        });
                    }
                    pending.extend(&item.blocks);
                }
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => pending.extend(blocks),
            _ => {}
        }
    }
    found
}

/// Il testo leggibile di una riga, senza la sintassi: la parte che l'utente legge.
fn plain(inlines: &[Inline]) -> String {
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

/// La scadenza: la data dopo l'ultimo `📅`. Una `📅` senza una data che esiste è
/// [`Due::Unreadable`], non [`Due::None`]: il compito c'è, e la data è sbagliata.
fn due_of(text: &str) -> Due {
    let Some((_, after)) = text.rsplit_once(DUE_MARK) else {
        return Due::None;
    };
    let word = after.split_whitespace().next().unwrap_or_default();
    civil_day(word).map_or(Due::Unreadable, Due::Day)
}

/// `AAAA-MM-GG` in giorni dall'epoca, se è una data che esiste.
fn civil_day(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u64> {
        let part = text.get(range)?;
        if part.bytes().all(|b| b.is_ascii_digit()) {
            part.parse().ok()
        } else {
            None
        }
    };
    let (year, month, day) = (number(0..4)?, number(5..7)?, number(8..10)?);
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year as i64, month) {
        return None;
    }
    Some(days_from_civil(year as i64, month, day))
}

fn iso(day: i64) -> String {
    let (year, month, day) = civil_from_days(day);
    format!("{year:04}-{month:02}-{day:02}")
}

// ---------------------------------------------------------------------------
// Il giorno e i gruppi
// ---------------------------------------------------------------------------

/// Il giorno di chi guarda e la fine della sua settimana, in giorni dall'epoca.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Calendar {
    today: i64,
    week_end: i64,
}

/// Il giorno e la settimana dell'utente, dall'orologio e dal locale dell'host.
fn calendar(host: &dyn ReadApi) -> Calendar {
    let locale = host.user_locale();
    let today = locale
        .to_civil_millis(host.now_unix_millis())
        .div_euclid(DAY_MS);
    calendar_of(today, locale.first_day_of_week)
}

/// La settimana che contiene `today` (giorni dall'epoca), se inizia di `first_day`.
fn calendar_of(today: i64, first_day: Weekday) -> Calendar {
    // Il 1970-01-01 fu un giovedì, cioè il 4 ISO: da lì si ricava il giorno della
    // settimana di qualunque giorno dall'epoca.
    let iso_weekday = (today + 3).rem_euclid(7) + 1;
    let first = i64::from(first_day.iso());
    let week_start = today - (iso_weekday - first).rem_euclid(7);
    Calendar {
        today,
        week_end: week_start + 6,
    }
}

/// Il gruppo di un compito, nell'ordine in cui si mostra.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Group {
    Overdue,
    ThisWeek,
    Later,
    NoDate,
}

fn group_of(due: Due, day: Calendar) -> Group {
    match due {
        Due::Day(d) if d < day.today => Group::Overdue,
        Due::Day(d) if d <= day.week_end => Group::ThisWeek,
        Due::Day(_) => Group::Later,
        Due::None | Due::Unreadable => Group::NoDate,
    }
}

fn group_title(group: Group) -> &'static str {
    match group {
        Group::Overdue => OVERDUE,
        Group::ThisWeek => THIS_WEEK,
        Group::Later => LATER,
        Group::NoDate => NO_DATE,
    }
}

// ---------------------------------------------------------------------------
// La lettura dell'indice
// ---------------------------------------------------------------------------

/// Quello che la vista ha letto: i compiti aperti, e che cosa non ha potuto leggere.
#[derive(Debug, Default)]
struct Gathered {
    tasks: Vec<Task>,
    /// Il vault ha più di [`READ_LIMIT`] compiti aperti: la lista è tagliata.
    more: bool,
    /// Note che l'indice nomina e che non si sono lette, perché sparite o illeggibili
    /// fra la domanda e la lettura.
    unread: usize,
}

/// Le note con compiti aperti dall'indice, e i compiti aperti di ciascuna.
fn gather(host: &dyn ReadApi) -> Result<Gathered, PluginError> {
    let question = IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::Task {
            status: TaskStatus::Open,
        }),
        sort: None,
        select: PropertySelect::None,
        page: None,
        excerpts: Excerpts::Omit,
    };
    let notes = host.query_index(question)?.documents()?;
    let mut gathered = Gathered::default();
    for hit in notes.items {
        match host.read_model(&hit.doc) {
            Ok(model) => gathered.tasks.extend(
                tasks_of(&model, &hit.doc)
                    .into_iter()
                    .filter(|task| !task.checked),
            ),
            Err(_) => gathered.unread += 1,
        }
        if gathered.tasks.len() > READ_LIMIT {
            gathered.tasks.truncate(READ_LIMIT);
            gathered.more = true;
            break;
        }
    }
    Ok(gathered)
}

// ---------------------------------------------------------------------------
// L'albero
// ---------------------------------------------------------------------------

/// L'albero della vista. `warning` è ciò che è appena andato storto, e non sta
/// nello stato: un guasto non sopravvive al ridisegno successivo.
fn tree(host: &dyn ReadApi, warning: Option<Text>) -> Result<UiNode, PluginError> {
    let day = calendar(host);
    let mut children = Vec::new();
    if let Some(warning) = warning {
        children.push(UiNode::failed(warning, None));
    }

    let gathered = match gather(host) {
        Ok(gathered) => gathered,
        Err(error) => {
            children.push(UiNode::failed(Text::key(query_failure(&error)), None));
            return Ok(UiNode::column(1, children));
        }
    };
    if gathered.unread > 0 {
        children.push(UiNode::failed(
            Text::message(
                UNREAD_NOTES,
                vec![Arg::int("count", gathered.unread as i64)],
            ),
            None,
        ));
    }

    let mut tasks = gathered.tasks;
    if tasks.is_empty() {
        children.push(UiNode::empty_state(Text::key(EMPTY)));
        return Ok(UiNode::column(1, children));
    }
    tasks.sort_by_cached_key(|task| {
        let due = match task.due {
            Due::Day(d) => d,
            Due::None | Due::Unreadable => i64::MAX,
        };
        (
            group_of(task.due, day),
            due,
            task.doc.as_str().to_string(),
            task.at,
        )
    });

    let total = tasks.len();
    let shown = total.min(SHOW_LIMIT);
    let visible = &tasks[..shown];
    for group in [Group::Overdue, Group::ThisWeek, Group::Later, Group::NoDate] {
        let rows: Vec<UiNode> = visible
            .iter()
            .filter(|task| group_of(task.due, day) == group)
            .map(|task| task_row(task, group))
            .collect();
        if !rows.is_empty() {
            children.push(
                UiNode::new(UiKind::Section {
                    title: Text::key(group_title(group)),
                    collapsed: false,
                    children: rows,
                })
                .with_key(group_title(group)),
            );
        }
    }

    if gathered.more {
        children.push(UiNode::text(Text::message(
            SHOWN_MANY,
            vec![
                Arg::int("shown", shown as i64),
                Arg::int("total", READ_LIMIT as i64),
            ],
        )));
    } else if total > shown {
        children.push(UiNode::text(Text::message(
            SHOWN,
            vec![
                Arg::int("shown", shown as i64),
                Arg::int("total", total as i64),
            ],
        )));
    }
    Ok(UiNode::column(1, children))
}

/// Una riga: la spunta con il testo del compito, la scadenza, e la nota d'origine,
/// che porta alla nota quando la si preme.
fn task_row(task: &Task, group: Group) -> UiNode {
    let payload = serde_json::json!({
        DOC: task.doc.as_str(),
        AT: task.at,
        SYMBOL: task.symbol.map(|c| c.to_string()).unwrap_or_default(),
        TEXT: task.text,
    });
    let check = UiNode::new(UiKind::Checkbox {
        field: "done".to_string(),
        label: Text::from(task.text.clone()),
        value: false,
        action: Some(ActionRef::with(TOGGLE, payload)),
    });
    let mut cells = vec![check];
    match task.due {
        Due::Day(day) => cells.push(UiNode::badge(
            Text::from(iso(day)),
            if group == Group::Overdue {
                Intent::Danger
            } else {
                Intent::Neutral
            },
        )),
        Due::Unreadable => cells.push(UiNode::badge(Text::key(UNREADABLE_DATE), Intent::Danger)),
        Due::None => {}
    }
    cells.push(UiNode::button(
        Text::from(task.doc.page_name().to_string()),
        Intent::Neutral,
        ActionRef::with(OPEN, serde_json::json!({ DOC: task.doc.as_str() })),
    ));
    UiNode::row(1, cells).with_key(format!("{}#{}", task.doc.as_str(), task.at))
}

/// La chiave del messaggio di un'interrogazione che non ha dato i compiti.
fn query_failure(error: &PluginError) -> &'static str {
    match error {
        PluginError::Unserved(_) => NO_INDEX,
        _ => QUERY_FAILED,
    }
}

// ---------------------------------------------------------------------------
// La spunta
// ---------------------------------------------------------------------------

/// Il compito come la vista l'ha disegnato, letto dal payload della sua spunta.
#[derive(Debug, PartialEq, Eq)]
struct Shown {
    doc: DocId,
    at: usize,
    symbol: Option<char>,
    text: String,
}

impl Shown {
    fn of(payload: &serde_json::Value) -> Option<Shown> {
        Some(Shown {
            doc: DocId::new(payload.get(DOC)?.as_str()?),
            at: usize::try_from(payload.get(AT)?.as_u64()?).ok()?,
            symbol: payload.get(SYMBOL)?.as_str()?.chars().next(),
            text: payload.get(TEXT)?.as_str()?.to_string(),
        })
    }
}

/// Spunta il compito disegnato, se in quella posizione c'è ancora.
///
/// La posizione è un byte di un file che può essere cambiato da quando la vista
/// l'ha disegnato: si spunta solo se lì c'è lo stesso compito, con lo stesso
/// simbolo e lo stesso testo. Altrimenti si ridisegna e non si scrive niente.
fn toggle(host: &mut dyn HostApi, payload: &serde_json::Value) -> Result<ViewUpdate, PluginError> {
    let Some(shown) = Shown::of(payload) else {
        return Ok(ViewUpdate::None);
    };
    let still_there = host.read_model(&shown.doc).is_ok_and(|model| {
        tasks_of(&model, &shown.doc).iter().any(|task| {
            task.at == shown.at && task.symbol == shown.symbol && task.text == shown.text
        })
    });
    if !still_there {
        return Ok(ViewUpdate::Replace {
            root: tree(&*host, Some(Text::key(CHANGED)))?,
        });
    }
    match host.run_command(
        NOTE_TASK_TOGGLE,
        serde_json::json!({ DOC: shown.doc.as_str(), AT: [shown.at] }),
    ) {
        // L'indice dirà che la nota è cambiata e la vista si ridisegna da sé.
        Ok(_) => Ok(ViewUpdate::None),
        Err(error) => Ok(ViewUpdate::Replace {
            root: tree(&*host, Some(Text::key(toggle_failure(&error))))?,
        }),
    }
}

/// La chiave del messaggio di una spunta che non è riuscita.
fn toggle_failure(error: &PluginError) -> &'static str {
    match error {
        PluginError::PermissionDenied(_) => READ_ONLY,
        PluginError::Conflict(_) => CHANGED,
        _ => TOGGLE_FAILED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(text: &str) -> i64 {
        civil_day(text).unwrap_or_else(|| panic!("{text} è una data"))
    }

    #[test]
    fn a_date_is_read_only_when_it_exists() {
        assert_eq!(civil_day("2026-10-19"), Some(day("2026-10-19")));
        assert_eq!(
            civil_day("2028-02-29"),
            Some(day("2028-02-29")),
            "bisestile"
        );
        for bad in [
            "2026-02-30",
            "2027-02-29",
            "2026-13-01",
            "2026-00-10",
            "2026-10-00",
            "2026-10-1",
            "2026-1O-19",
            "",
        ] {
            assert_eq!(civil_day(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_due_date_is_the_last_marker_and_a_wrong_one_is_unreadable() {
        assert_eq!(due_of("Pagare 📅 2026-10-19"), Due::Day(day("2026-10-19")));
        assert_eq!(
            due_of("Ricorda 📅 2026-10-01 da fare 📅 2026-10-19 ✅"),
            Due::Day(day("2026-10-19")),
            "conta l'ultima"
        );
        assert_eq!(due_of("Senza scadenza"), Due::None);
        assert_eq!(due_of("Refuso 📅 2026-02-30"), Due::Unreadable);
        assert_eq!(due_of("Vuoto 📅"), Due::Unreadable);
    }

    #[test]
    fn the_week_starts_on_the_locale_first_day() {
        // 2026-11-09 è un lunedì.
        let monday = day("2026-11-09");
        let from_monday = calendar_of(monday, Weekday::Monday);
        assert_eq!(from_monday.today, monday);
        assert_eq!(from_monday.week_end, monday + 6, "lunedì → domenica");
        let from_sunday = calendar_of(monday, Weekday::Sunday);
        assert_eq!(from_sunday.week_end, monday + 5, "domenica → sabato");
        // Di domenica, con la settimana che inizia di lunedì, la settimana chiude
        // quel giorno; con quella che inizia di domenica chiude sei giorni dopo.
        let sunday = day("2026-11-15");
        assert_eq!(calendar_of(sunday, Weekday::Monday).week_end, sunday);
        assert_eq!(calendar_of(sunday, Weekday::Sunday).week_end, sunday + 6);
    }

    #[test]
    fn a_group_follows_the_day_it_is_read_on() {
        let day_of = |today: i64, due| {
            group_of(
                due,
                Calendar {
                    today,
                    week_end: today + 6,
                },
            )
        };
        let today = day("2026-11-13");
        assert_eq!(day_of(today, Due::Day(today - 1)), Group::Overdue);
        assert_eq!(day_of(today, Due::Day(today)), Group::ThisWeek);
        assert_eq!(day_of(today, Due::Day(today + 6)), Group::ThisWeek);
        assert_eq!(day_of(today, Due::Day(today + 7)), Group::Later);
        assert_eq!(day_of(today, Due::None), Group::NoDate);
        assert_eq!(day_of(today, Due::Unreadable), Group::NoDate);
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
                span: fub_abi::model::Span::new(0, 5),
            },
            Inline::SoftBreak,
            Inline::Text("📅 2026-10-19".into()),
        ];
        assert_eq!(plain(&inlines), "Pagare la bolletta #casa 📅 2026-10-19");
    }
}
