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
//! La scadenza è la data dopo l'ultimo `📅`, come la scrive il plugin Tasks: la
//! regola è del contratto ([`fub_abi::rules::tasks`]), la stessa della ricerca e
//! della pastiglia nel testo. Le date ricorrenti (`🔁`) non hanno un trattamento
//! a parte: la riga di oggi porta la sua scadenza, e spuntarla fa nascere la
//! successiva con il comando che ricorre già.
//!
//! # Il recinto ```` ```tasks ````
//!
//! La stessa vista ha un secondo esemplare, [`TASKS_QUERY_VIEW`]: i compiti che
//! rispondono alle righe di un recinto ```` ```tasks ```` di una nota, come le
//! scrive il plugin Tasks (le righe capite sono in [`query`]). La shell lo monta
//! dentro la nota al posto del recinto, con le righe nel parametro `query`; il
//! recinto si dichiara con [`TasksFenceRule`], quindi col componente spento
//! resta un blocco di codice. La lettura dei compiti, la scadenza e la spunta
//! sono quelle della vista nell'ispettore: un compito solo, letto in un modo
//! solo.
//!
//! # La spunta
//!
//! Il payload di ogni compito porta dove stava (il byte del marcatore), il suo
//! simbolo, il suo testo e la revisione della nota letta *prima* del modello.
//! Chi spunta rilegge la nota e controlla che in quella posizione ci sia ancora
//! lo stesso compito: se la nota è cambiata sotto, la vista si ridisegna e non
//! spunta niente. Poi chiama `note.task.toggle` con la posizione **e la
//! revisione**: il comando non scrive se la nota non è più quella che la vista
//! ha letto, quindi fra il controllo e la scrittura non resta una finestra.
//!
//! # I tetti
//!
//! La vista tiene al più [`READ_LIMIT`] compiti e ne disegna al più
//! [`SHOW_LIMIT`]. Il taglio viene **dopo l'ordine**: si leggono tutte le note
//! che l'indice nomina, e di tanto in tanto si mettono in ordine i compiti
//! tenuti e si scarta la coda, così i compiti che restano sono i primi
//! nell'ordine della vista (o del recinto, col suo `limit`) e non i primi
//! delle note lette. Quando taglia lo dice: un vault con diecimila compiti non
//! è una lista da scorrere, ed è meglio una lista corta che dice quanto manca
//! che una lunga che si blocca al disegno.
//!
//! Prima di leggere una nota si guarda ciò che il suo nome basta a dire (il
//! `path includes` di un recinto): una nota che non può rispondere non si
//! legge.

mod query;

use fub_abi::command::{ParamKind, ParamSpec};
use fub_abi::custom::{
    CustomBlock, CustomRenderer, CustomRendererSpec, CustomRendering, SyntaxMatch, SyntaxProduct,
    SyntaxRule, SyntaxRuleSpec, SyntaxTrigger,
};
use fub_abi::edit::Revision;
use fub_abi::error::{FormatError, PluginError};
use fub_abi::event::{EventKind, EventMask};
use fub_abi::format::{ParseContext, RenderOptions};
use fub_abi::html::escape;
use fub_abi::locale::Weekday;
use fub_abi::model::{canonical_tag, Block, DocId, DocumentModel, Inline};
use fub_abi::query::{QueryExpr, QueryPredicate, TaskStatus};
use fub_abi::rules::tasks::{due_is_near, iso_day, task_due, task_text};
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
/// Id della `ViewSpec` del recinto ```` ```tasks ````: la shell la monta dentro
/// una nota, con le righe del recinto nel parametro [`QUERY`].
pub const TASKS_QUERY_VIEW: &str = "tasks_query";
/// L'id della regola che dichiara il recinto.
pub const TASKS_FENCE_RULE: &str = "fub:tasks";
/// L'id del renderer del recinto, fuori dalla shell (export, resa dell'host).
pub const TASKS_FENCE_RENDERER: &str = "fub:tasks";
/// La specie del blocco che il recinto diventa nel modello.
pub const TASKS_FENCE_KIND: &str = "fub:tasks-query";
/// La parola del recinto: ```` ```tasks ````.
const FENCE_INFO: &str = "tasks";
/// Il parametro del recinto: le sue righe, com'erano scritte.
pub const QUERY: &str = "query";

/// Il comando del registro che spunta un compito (`commands/tasks.rs`).
///
/// È una stringa e non l'import di [`crate::commands`], per la stessa ragione di
/// `trash.rs`: l'id di un comando è un nome del registro, cioè ciò che scriverebbe
/// un plugin di terzi. `tests/tasks_e2e.rs` lo cerca fra i comandi registrati.
const NOTE_TASK_TOGGLE: &str = "note.task.toggle";

/// Quanti compiti la vista tiene al più, i primi nel suo ordine. Oltre, il vault ne
/// ha di più e la vista lo dice.
pub const READ_LIMIT: usize = 10_000;
/// Quanti compiti la vista disegna al più, nell'ordine dei gruppi.
pub const SHOW_LIMIT: usize = 300;
/// Quanti compiti un recinto disegna al più: sta dentro una nota, e una nota
/// non è un elenco da scorrere.
pub const FENCE_SHOW_LIMIT: usize = 100;

/// Un giorno, in millisecondi.
const DAY_MS: i64 = 86_400_000;

/// Le azioni che la vista riceve dai suoi nodi.
const OPEN: &str = "open";
const TOGGLE: &str = "toggle";

/// Le chiavi del payload di un compito.
const DOC: &str = "doc";
const AT: &str = "at";
const SYMBOL: &str = "symbol";
const TEXT: &str = "text";
const REVISION: &str = "revision";

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
const QUERY_TITLE: &str = "query_title";
const QUERY_PARAM: &str = "query_param";
const FENCE_EMPTY: &str = "fence_empty";
const FENCE_NONE: &str = "fence_none";
const FENCE_SKIPPED: &str = "fence_skipped";
const FENCE_COUNT_ONE: &str = "fence_count_one";
const FENCE_COUNT: &str = "fence_count";
const FENCE_SHOWN: &str = "fence_shown";
const FENCE_SHOWN_MANY: &str = "fence_shown_many";

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
            .with(TOGGLE_FAILED, "Non ho spuntato il compito.")
            .with(QUERY_TITLE, "Compiti del recinto")
            .with(QUERY_PARAM, "Righe del recinto")
            .with(
                FENCE_EMPTY,
                "Scrivi nel recinto quali compiti mostrare, una riga per volta: per esempio «not done» o «due before tomorrow».",
            )
            .with(FENCE_NONE, "Nessun compito risponde a queste righe.")
            .with(FENCE_SKIPPED, "Non capisco la riga {line} («{text}»): la salto.")
            .with(FENCE_COUNT_ONE, "1 compito")
            .with(FENCE_COUNT, "{count} compiti")
            .with(
                FENCE_SHOWN,
                "Mostro i primi {shown} di {total}: restringi con le righe del recinto.",
            )
            .with(
                FENCE_SHOWN_MANY,
                "Mostro i primi {shown}: il vault ne ha più di {total}. Restringi con le righe del recinto.",
            ),
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
            .with(TOGGLE_FAILED, "Could not check the task.")
            .with(QUERY_TITLE, "Tasks of the block")
            .with(QUERY_PARAM, "Lines of the block")
            .with(
                FENCE_EMPTY,
                "Write in the block which tasks to show, one line at a time: for example “not done” or “due before tomorrow”.",
            )
            .with(FENCE_NONE, "No task matches these lines.")
            .with(FENCE_SKIPPED, "I don't understand line {line} (“{text}”): skipping it.")
            .with(FENCE_COUNT_ONE, "1 task")
            .with(FENCE_COUNT, "{count} tasks")
            .with(
                FENCE_SHOWN,
                "Showing the first {shown} of {total}: narrow it down with the block's lines.",
            )
            .with(
                FENCE_SHOWN_MANY,
                "Showing the first {shown}: the vault has more than {total}. Narrow it down with the block's lines.",
            ),
    ]
}

/// La vista dei compiti.
///
/// **Senza campi**, come il cestino: non ha stato proprio. Tutto ciò che disegna
/// lo rilegge, e una spunta si fa con un comando del registro.
pub struct TasksView;

impl ViewProvider for TasksView {
    fn views(&self) -> Vec<ViewSpec> {
        vec![
            // Nella colonna dell'ispettore e chiusa di suo: si apre quando
            // qualcuno la chiede, come le altre viste dell'ispettore.
            ViewSpec::new(TASKS_VIEW, Text::key(VIEW_TITLE), ViewSurface::RightSidebar)
                .with_icon("tasks")
                .ordered(3),
            // Il recinto: un esemplare per recinto, dentro la nota che lo
            // contiene. Il parametro è obbligatorio, quindi non compare fra le
            // viste che si aprono da sole (palette, rail, menu).
            ViewSpec::new(TASKS_QUERY_VIEW, Text::key(QUERY_TITLE), ViewSurface::Main)
                .with_icon("tasks")
                .with_params(vec![ParamSpec::new(
                    QUERY,
                    Text::key(QUERY_PARAM),
                    ParamKind::Text,
                )
                .required()]),
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
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        render(instance, host, None)
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
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
            TOGGLE => toggle(instance, host, &action.payload),
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// L'albero dell'esemplare: la vista dell'ispettore o un recinto.
fn render(
    instance: &ViewInstance,
    host: &dyn ReadApi,
    warning: Option<Text>,
) -> Result<UiNode, PluginError> {
    if instance.view == TASKS_QUERY_VIEW {
        let source = instance
            .params
            .get(QUERY)
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        fence_tree(host, source, warning)
    } else {
        tree(host, warning)
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
    /// Il testo del compito ([`task_text`]): il primo paragrafo, senza sintassi.
    text: String,
    due: Due,
    /// Dove sta la scadenza in [`Task::text`], segno compreso.
    due_span: Option<(usize, usize)>,
    /// I tag del testo, in forma canonica.
    tags: Vec<String>,
    /// La revisione della nota letta prima del modello: la spunta la porta al
    /// comando, che non scrive su una nota diversa da questa.
    revision: Option<Revision>,
}

impl Task {
    /// Il testo da mostrare accanto a una scadenza disegnata a parte: senza il
    /// `📅` e la sua data, che altrimenti si leggerebbero due volte.
    fn label(&self) -> String {
        match self.due_span {
            Some((from, to)) => {
                let before = self.text[..from].trim_end();
                let after = self.text[to..].trim_start();
                match (before.is_empty(), after.is_empty()) {
                    (_, true) => before.to_string(),
                    (true, false) => after.to_string(),
                    (false, false) => format!("{before} {after}"),
                }
            }
            None => self.text.clone(),
        }
    }
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
/// blocchi custom. Il testo e la scadenza sono quelli della regola del contratto.
fn tasks_of(model: &DocumentModel, doc: &DocId) -> Vec<Task> {
    let mut found = Vec::new();
    let mut pending: Vec<&Block> = model.body.iter().collect();
    while let Some(block) = pending.pop() {
        match block {
            Block::List { items, .. } => {
                for item in items {
                    if let Some(marker) = item.task {
                        let text = task_text(&item.blocks);
                        let due = task_due(&text);
                        let mut tags = Vec::new();
                        if let Some(Block::Paragraph { inlines, .. }) = item.blocks.first() {
                            push_tags(inlines, &mut tags);
                        }
                        found.push(Task {
                            doc: doc.clone(),
                            at: marker.span.start,
                            symbol: marker.symbol,
                            checked: marker.checked(),
                            due: match due {
                                None => Due::None,
                                Some(due) => due.day.map_or(Due::Unreadable, Due::Day),
                            },
                            due_span: due.map(|due| (due.from, due.to)),
                            tags,
                            revision: None,
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

/// I tag di una riga di inline, in forma canonica.
fn push_tags(inlines: &[Inline], out: &mut Vec<String>) {
    for inline in inlines {
        match inline {
            Inline::TagRef { name, .. } => out.push(canonical_tag(name)),
            Inline::Emph(inner)
            | Inline::Strong(inner)
            | Inline::Superscript(inner)
            | Inline::Subscript(inner)
            | Inline::Strikethrough(inner) => push_tags(inner, out),
            Inline::Link {
                label: Some(label), ..
            } => push_tags(label, out),
            _ => {}
        }
    }
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

/// Quello che la vista ha letto: i compiti tenuti, e che cosa non ha potuto leggere.
#[derive(Debug, Default)]
struct Gathered {
    tasks: Vec<Task>,
    /// Il vault ha più di [`READ_LIMIT`] compiti che rispondono: la lista è tagliata.
    more: bool,
    /// Note che l'indice nomina e che non si sono lette, perché sparite o illeggibili
    /// fra la domanda e la lettura.
    unread: usize,
}

/// Le note che l'indice nomina per `matching` e che `reads` lascia leggere, e
/// di ciascuna i compiti che `keep` tiene; ne restano al più `cap`, i primi
/// secondo `order`.
///
/// Il taglio viene dopo l'ordine: quando i compiti tenuti superano il doppio
/// di `cap` si ordinano e si scarta la coda, e così alla fine. La memoria resta
/// proporzionale a `cap`, e i compiti che restano non dipendono dall'ordine in
/// cui l'indice nomina le note.
///
/// La revisione si legge **prima** del modello: se la nota cambia fra le due
/// letture, la revisione è quella vecchia e la spunta trova un conflitto invece
/// di scrivere su un compito che la vista non ha mai visto.
fn gather(
    host: &dyn ReadApi,
    matching: QueryExpr,
    reads: impl Fn(&DocId) -> bool,
    keep: impl Fn(&Task) -> bool,
    order: impl Fn(&mut [Task]),
    cap: usize,
) -> Result<Gathered, PluginError> {
    let question = IndexQuery::Documents {
        matching,
        sort: None,
        select: PropertySelect::None,
        page: None,
        excerpts: Excerpts::Omit,
    };
    let notes = host.query_index(question)?.documents()?;
    let mut gathered = Gathered::default();
    let cut = |tasks: &mut Vec<Task>, more: &mut bool| {
        if tasks.len() > cap {
            order(tasks);
            tasks.truncate(cap);
            *more = true;
        }
    };
    for hit in notes.items {
        if !reads(&hit.doc) {
            continue;
        }
        let revision = host.document_revision(&hit.doc).ok();
        match host.read_model(&hit.doc) {
            Ok(model) => gathered.tasks.extend(
                tasks_of(&model, &hit.doc)
                    .into_iter()
                    .filter(|task| keep(task))
                    .map(|task| Task {
                        revision: revision.clone(),
                        ..task
                    }),
            ),
            Err(_) => gathered.unread += 1,
        }
        if gathered.tasks.len() > cap.saturating_mul(2) {
            cut(&mut gathered.tasks, &mut gathered.more);
        }
    }
    cut(&mut gathered.tasks, &mut gathered.more);
    order(&mut gathered.tasks);
    Ok(gathered)
}

/// La domanda della vista dell'ispettore: le note con almeno un compito aperto.
fn open_tasks() -> QueryExpr {
    QueryExpr::of(QueryPredicate::Task {
        status: TaskStatus::Open,
    })
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

    let gathered = match gather(
        host,
        open_tasks(),
        |_| true,
        |task| !task.checked,
        |tasks| inspector_order(tasks, day),
        READ_LIMIT,
    ) {
        Ok(gathered) => gathered,
        Err(error) => {
            children.push(UiNode::failed(Text::key(query_failure(&error)), None));
            return Ok(UiNode::column(1, children));
        }
    };
    if gathered.unread > 0 {
        children.push(unread_notice(gathered.unread));
    }

    let tasks = gathered.tasks;
    if tasks.is_empty() {
        children.push(UiNode::empty_state(Text::key(EMPTY)));
        return Ok(UiNode::column(1, children));
    }

    let total = tasks.len();
    let shown = total.min(SHOW_LIMIT);
    let visible = &tasks[..shown];
    for group in [Group::Overdue, Group::ThisWeek, Group::Later, Group::NoDate] {
        let rows: Vec<UiNode> = visible
            .iter()
            .filter(|task| group_of(task.due, day) == group)
            .map(|task| task_row(task, day))
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

/// L'ordine della vista dell'ispettore: per gruppo, poi per scadenza, nota e
/// posizione.
fn inspector_order(tasks: &mut [Task], day: Calendar) {
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
}

/// L'albero di un recinto: le righe saltate dette, il conto, e i compiti che
/// rispondono, nell'ordine chiesto.
fn fence_tree(
    host: &dyn ReadApi,
    source: &str,
    warning: Option<Text>,
) -> Result<UiNode, PluginError> {
    let day = calendar(host);
    let query = query::parse(source, day.today);
    let mut children = Vec::new();
    if let Some(warning) = warning {
        children.push(UiNode::failed(warning, None));
    }
    for skipped in &query.skipped {
        children.push(
            UiNode::text(Text::message(
                FENCE_SKIPPED,
                vec![
                    Arg::int("line", skipped.line as i64),
                    Arg::text("text", skipped.text.clone()),
                ],
            ))
            .with_key(format!("skipped-{}", skipped.line)),
        );
    }
    if query.selects_nothing() {
        children.push(UiNode::empty_state(Text::key(FENCE_EMPTY)));
        return Ok(UiNode::column(1, children));
    }
    // Il limite del plugin vale dopo l'ordine, come il tetto: «i primi cinque
    // per scadenza», non cinque qualunque. Un limite che taglia non è un vault
    // con troppi compiti, e non si dice.
    let cap = query.limit.map_or(READ_LIMIT, |limit| limit.min(READ_LIMIT));
    let gathered = match query.matching() {
        None => Gathered::default(),
        Some(matching) => match gather(
            host,
            matching,
            |doc| query.reads(doc),
            |task| query.keeps(task),
            |tasks| query.sort(tasks),
            cap,
        ) {
            Ok(gathered) => Gathered {
                more: gathered.more && cap == READ_LIMIT,
                ..gathered
            },
            Err(error) => {
                children.push(UiNode::failed(Text::key(query_failure(&error)), None));
                return Ok(UiNode::column(1, children));
            }
        },
    };
    if gathered.unread > 0 {
        children.push(unread_notice(gathered.unread));
    }
    let tasks = gathered.tasks;
    if tasks.is_empty() {
        children.push(UiNode::empty_state(Text::key(FENCE_NONE)));
        return Ok(UiNode::column(1, children));
    }
    let total = tasks.len();
    children.push(
        UiNode::text(if total == 1 {
            Text::key(FENCE_COUNT_ONE)
        } else {
            Text::message(FENCE_COUNT, vec![Arg::int("count", total as i64)])
        })
        .with_key("count"),
    );
    let shown = total.min(FENCE_SHOW_LIMIT);
    let rows: Vec<UiNode> = tasks[..shown]
        .iter()
        .map(|task| task_row(task, day))
        .collect();
    children.push(UiNode::column(1, rows).with_key("tasks"));
    if gathered.more {
        children.push(UiNode::text(Text::message(
            FENCE_SHOWN_MANY,
            vec![
                Arg::int("shown", shown as i64),
                Arg::int("total", READ_LIMIT as i64),
            ],
        )));
    } else if total > shown {
        children.push(UiNode::text(Text::message(
            FENCE_SHOWN,
            vec![
                Arg::int("shown", shown as i64),
                Arg::int("total", total as i64),
            ],
        )));
    }
    Ok(UiNode::column(1, children))
}

fn unread_notice(count: usize) -> UiNode {
    UiNode::failed(
        Text::message(UNREAD_NOTES, vec![Arg::int("count", count as i64)]),
        None,
    )
}

/// Una riga: la spunta con il testo del compito, e sotto la scadenza e la nota
/// d'origine, che porta alla nota quando la si preme.
///
/// La scadenza disegnata nella pastiglia esce dal testo: «Pagare la luce» con
/// accanto `2026-08-21`, non «Pagare la luce 📅 2026-08-21» e di nuovo la data.
/// Il payload porta invece il testo intero, che è ciò con cui la spunta
/// riconosce il compito nella nota.
fn task_row(task: &Task, day: Calendar) -> UiNode {
    let payload = serde_json::json!({
        DOC: task.doc.as_str(),
        AT: task.at,
        SYMBOL: task.symbol.map(|c| c.to_string()).unwrap_or_default(),
        TEXT: task.text,
        REVISION: task.revision.as_ref().map(|r| r.0.clone()),
    });
    let check = UiNode::new(UiKind::Checkbox {
        field: "done".to_string(),
        label: Text::from(task.label()),
        value: task.checked,
        action: Some(ActionRef::with(TOGGLE, payload)),
    });
    let mut meta = Vec::new();
    match task.due {
        Due::Day(due) => meta.push(UiNode::badge(
            Text::from(iso_day(due)),
            // Vicina come la pastiglia nel testo (`due_is_near`): passata, di
            // oggi o entro la settimana, e solo per un compito aperto.
            if !task.checked && due_is_near(due, day.today) {
                Intent::Danger
            } else {
                Intent::Neutral
            },
        )),
        Due::Unreadable => meta.push(UiNode::badge(Text::key(UNREADABLE_DATE), Intent::Danger)),
        Due::None => {}
    }
    meta.push(UiNode::button(
        Text::from(task.doc.page_name().to_string()),
        Intent::Neutral,
        ActionRef::with(OPEN, serde_json::json!({ DOC: task.doc.as_str() })),
    ));
    UiNode::column(0, vec![check, UiNode::row(1, meta)]).with_key(format!(
        "{}#{}",
        task.doc.as_str(),
        task.at
    ))
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
    revision: Option<String>,
}

impl Shown {
    fn of(payload: &serde_json::Value) -> Option<Shown> {
        Some(Shown {
            doc: DocId::new(payload.get(DOC)?.as_str()?),
            at: usize::try_from(payload.get(AT)?.as_u64()?).ok()?,
            symbol: payload.get(SYMBOL)?.as_str()?.chars().next(),
            text: payload.get(TEXT)?.as_str()?.to_string(),
            revision: payload
                .get(REVISION)
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }
}

/// Spunta il compito disegnato, se in quella posizione c'è ancora.
///
/// La posizione è un byte di un file che può essere cambiato da quando la vista
/// l'ha disegnato: si spunta solo se lì c'è lo stesso compito, con lo stesso
/// simbolo e lo stesso testo. Altrimenti si ridisegna e non si scrive niente.
/// Il comando riceve anche la revisione letta al disegno, e non scrive se la
/// nota non è più quella: il controllo qui sopra dice *perché*, la revisione
/// impedisce che una modifica arrivata in mezzo passi.
fn toggle(
    instance: &ViewInstance,
    host: &mut dyn HostApi,
    payload: &serde_json::Value,
) -> Result<ViewUpdate, PluginError> {
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
            root: render(instance, &*host, Some(Text::key(CHANGED)))?,
        });
    }
    let mut args = serde_json::json!({ DOC: shown.doc.as_str(), AT: [shown.at] });
    if let Some(revision) = &shown.revision {
        args[REVISION] = serde_json::Value::String(revision.clone());
    }
    match host.run_command(NOTE_TASK_TOGGLE, args) {
        // L'indice dirà che la nota è cambiata e la vista si ridisegna da sé.
        Ok(_) => Ok(ViewUpdate::None),
        Err(error) => Ok(ViewUpdate::Replace {
            root: render(instance, &*host, Some(Text::key(toggle_failure(&error))))?,
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

// ---------------------------------------------------------------------------
// Il recinto, nel modello e fuori dalla shell
// ---------------------------------------------------------------------------

/// ```` ```tasks ```` diventa un blocco [`TASKS_FENCE_KIND`] con le sue righe.
///
/// È la **dichiarazione** del recinto: la shell riconosce le info string che le
/// regole registrate dichiarano (`declaredFences`), e soltanto un recinto
/// dichiarato si legge reso invece che come codice. Registrata dal componente,
/// col componente spento non c'è, e il recinto resta codice.
pub struct TasksFenceRule;

impl SyntaxRule for TasksFenceRule {
    fn spec(&self) -> SyntaxRuleSpec {
        SyntaxRuleSpec {
            id: TASKS_FENCE_RULE.into(),
            format: "markdown".into(),
            trigger: SyntaxTrigger::Fence {
                info: vec![FENCE_INFO.into()],
            },
            order: 0,
            option: None,
            produces: vec![TASKS_FENCE_KIND.into()],
        }
    }

    fn apply(
        &self,
        m: &SyntaxMatch,
        _ctx: &ParseContext,
    ) -> Result<Option<SyntaxProduct>, FormatError> {
        Ok(Some(SyntaxProduct::Block {
            custom_kind: TASKS_FENCE_KIND.into(),
            attrs: serde_json::json!({ QUERY: m.text }),
            blocks: vec![],
        }))
    }
}

/// Fuori dalla shell (un export, la resa dell'host) il recinto è ciò che è
/// scritto: le sue righe in un blocco di codice `tasks`. I compiti veri li
/// disegna la shell, che ha la vista.
pub struct TasksFenceRenderer;

impl CustomRenderer for TasksFenceRenderer {
    fn spec(&self) -> CustomRendererSpec {
        CustomRendererSpec {
            id: TASKS_FENCE_RENDERER.into(),
            kinds: vec![TASKS_FENCE_KIND.into()],
        }
    }

    fn render(
        &self,
        block: &CustomBlock,
        _opts: &RenderOptions,
    ) -> Result<CustomRendering, FormatError> {
        let Some(source) = block.attrs.get(QUERY).and_then(|v| v.as_str()) else {
            return Ok(CustomRendering::Fallback);
        };
        Ok(CustomRendering::Html(format!(
            "<pre><code class=\"language-{FENCE_INFO}\">{}</code></pre>",
            escape(source)
        )))
    }
}

/// Le regole del componente, per l'inventario.
pub fn syntax_rules() -> Vec<Box<dyn SyntaxRule>> {
    vec![Box::new(TasksFenceRule)]
}

/// I renderer del componente, per l'inventario.
pub fn renderers() -> Vec<Box<dyn CustomRenderer>> {
    vec![Box::new(TasksFenceRenderer)]
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::rules::tasks::civil_day;

    fn day(text: &str) -> i64 {
        civil_day(text).unwrap_or_else(|| panic!("{text} è una data"))
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

    fn task_with(text: &str) -> Task {
        let due = task_due(text);
        Task {
            doc: DocId::new("a.md"),
            at: 0,
            symbol: None,
            checked: false,
            text: text.to_string(),
            due: due.map_or(Due::None, |d| d.day.map_or(Due::Unreadable, Due::Day)),
            due_span: due.map(|d| (d.from, d.to)),
            tags: Vec::new(),
            revision: None,
        }
    }

    #[test]
    fn the_label_leaves_out_the_due_date_the_badge_shows() {
        assert_eq!(
            task_with("Pagare la luce 📅 2026-08-21").label(),
            "Pagare la luce"
        );
        assert_eq!(
            task_with("Pagare 📅 2026-08-21 la luce").label(),
            "Pagare la luce"
        );
        assert_eq!(task_with("📅 2026-08-21 Pagare").label(), "Pagare");
        assert_eq!(task_with("Refuso 📅 2026-02-30").label(), "Refuso");
        assert_eq!(task_with("Senza data").label(), "Senza data");
    }
}
