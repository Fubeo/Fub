//! La pagina del giorno (E17): in fondo alla giornaliera, resa e mai scritta,
//! tre gruppi che si chiudono a richiesta.
//!
//! - **Compiti di oggi** (di quel giorno, se la giornaliera è di un altro): i
//!   compiti aperti la cui scadenza (`📅`) cade quel giorno. L'indice dice quali
//!   note ne hanno ([`QueryPredicate::TaskDue`]); il compito si legge dal modello
//!   con la regola del contratto ([`task_text`], [`task_due`]), la stessa della
//!   vista dei compiti, che qui non si nomina: si interroga l'indice.
//! - **Stesso giorno**: le note che hanno quella data in una proprietà
//!   qualsiasi, da sola o dentro un elenco. Il giorno è quello scritto: l'ora e
//!   il fuso di un valore non lo spostano.
//! - **Create e cambiate**: le note la cui ultima modifica cade quel giorno,
//!   nel fuso di chi guarda. L'anagrafe ha l'ultima modifica e non la nascita
//!   di un file: una nota creata quel giorno e cambiata dopo compare nel giorno
//!   dell'ultima modifica.
//!
//! La vista non scrive niente e la giornaliera resta com'è: la shell la monta
//! come widget dopo l'ultima riga (`markdown/day-page.ts`), quindi non è nel
//! file, né in ciò che si copia, né nell'export. Si ridisegna all'apertura e a
//! ogni evento dell'indice, mai per battuta.
//!
//! La shell passa la nota (`doc`) e il giorno che legge nel suo nome (`date`):
//! qui si controlla che la nota sia davvero la giornaliera di quel giorno, con
//! la cartella, il formato e la lingua di adesso ([`daily_name`]). Se non lo è
//! la vista non mostra niente.

use super::super::*;
use fub_abi::model::{Block, DocumentModel, PropertyScalar, PropertyValue};
use fub_abi::query::{DueBound, QueryExpr, QueryPredicate};
use fub_abi::rules::tasks::{civil_day, task_due, task_text};
use fub_abi::traits::{EntryKind, Excerpts, Page, PropertySelect};

/// La vista: un esemplare per giornaliera aperta, dentro la nota.
pub(in crate::template) const DAY_PAGE_VIEW: &str = "day_page";
/// Il gesto su una riga: apre la nota.
const DAY_OPEN: &str = "day.open";

pub(in crate::template) const DAY_TITLE: &str = "day.title";
pub(in crate::template) const DAY_TASKS_TODAY: &str = "day.tasks.today";
pub(in crate::template) const DAY_TASKS_OTHER: &str = "day.tasks.other";
pub(in crate::template) const DAY_TASKS_TODAY_BARE: &str = "day.tasks.today.bare";
pub(in crate::template) const DAY_TASKS_OTHER_BARE: &str = "day.tasks.other.bare";
pub(in crate::template) const DAY_TASKS_MORE: &str = "day.tasks.more";
pub(in crate::template) const DAY_TASKS_UNREAD: &str = "day.tasks.unread";
pub(in crate::template) const DAY_TASKS_NONE: &str = "day.tasks.none";
pub(in crate::template) const DAY_TASKS_UNSERVED: &str = "day.tasks.unserved";
pub(in crate::template) const DAY_TASKS_FAILED: &str = "day.tasks.failed";
pub(in crate::template) const DAY_SAME: &str = "day.same";
pub(in crate::template) const DAY_SAME_NONE: &str = "day.same.none";
pub(in crate::template) const DAY_CHANGED: &str = "day.changed";
pub(in crate::template) const DAY_CHANGED_NONE: &str = "day.changed.none";
pub(in crate::template) const DAY_CHANGED_AT: &str = "day.changed.at";
pub(in crate::template) const DAY_MORE: &str = "day.more";
pub(in crate::template) const DAY_DOC: &str = "day.doc";
pub(in crate::template) const DAY_DATE: &str = "day.date";

/// Quante righe mostra un gruppo: le altre si contano («e altre 950»).
pub(in crate::template) const DAY_ROWS: usize = 50;
/// Quante note con un compito di quel giorno si leggono: leggere un modello
/// costa, e la vista si ridisegna a ogni salvataggio.
pub(in crate::template) const DAY_TASK_NOTES: u32 = 50;

const KEY_TASKS: &str = "day-tasks";
const KEY_SAME: &str = "day-same";
const KEY_CHANGED: &str = "day-changed";
const A_TIME: &str = "time";

/// La dichiarazione: nell'area principale come il recinto dei compiti, e coi
/// parametri obbligatori, quindi non compare fra le viste che si aprono da sole.
pub(in crate::template) fn day_spec() -> ViewSpec {
    ViewSpec::new(DAY_PAGE_VIEW, Text::key(DAY_TITLE), ViewSurface::Main)
        .with_icon("calendar")
        .with_params(vec![
            ParamSpec::new(DOC, Text::key(DAY_DOC), ParamKind::Text).required(),
            ParamSpec::new(DATE, Text::key(DAY_DATE), ParamKind::Text).required(),
        ])
}

/// La nota e il giorno dei parametri, se la nota è la giornaliera di quel
/// giorno.
fn daily_of(instance: &ViewInstance, host: &dyn ReadApi) -> Option<(DocId, String)> {
    let doc = instance.params.get(DOC)?.as_str()?;
    let date = instance.params.get(DATE)?.as_str()?;
    civil_day(date)?;
    // L'estensione è quella del nome, non di una cartella con un punto.
    let name_start = doc.rfind('/').map_or(0, |slash| slash + 1);
    let dot = name_start + doc[name_start..].rfind('.')?;
    let folder_and_stem = &doc[..dot];
    let language = host.user_locale().language_base().to_string();
    let expected = format!(
        "{}/{}",
        daily_folder(host),
        daily_name(&daily_format(host), date, &language)
    );
    (folder_and_stem == expected).then(|| (DocId::new(doc), date.to_string()))
}

/// La pagina del giorno, o niente se la nota non è una giornaliera.
pub(in crate::template) fn day_page(
    instance: &ViewInstance,
    host: &dyn ReadApi,
) -> Result<UiNode, PluginError> {
    let Some((doc, date)) = daily_of(instance, host) else {
        return Ok(UiNode::column(0, Vec::new()));
    };
    let today = today(host)?;
    Ok(UiNode::column(
        4,
        vec![
            tasks_group(host, &date, date == today)?,
            same_day_group(host, &doc, &date)?,
            changed_group(host, &doc, &date)?,
        ],
    ))
}

/// Un gesto della pagina: una riga apre la sua nota.
pub(in crate::template) fn day_action(action: &UiAction) -> ViewUpdate {
    if action.action.0 != DAY_OPEN {
        return ViewUpdate::None;
    }
    match action.payload.get(DOC).and_then(|v| v.as_str()) {
        Some(doc) => ViewUpdate::Navigate {
            doc_id: doc.to_string(),
        },
        None => ViewUpdate::None,
    }
}

/// Un gruppo: il titolo col conto, e dentro le righe o la frase del vuoto.
/// Aperto all'inizio; chiuderlo è della shell, e la chiave lo tiene chiuso
/// attraverso i ridisegni.
fn group(key: &str, title: Text, children: Vec<UiNode>) -> UiNode {
    UiNode::keyed(
        key,
        UiKind::Section {
            title,
            collapsed: false,
            children,
        },
    )
}

fn count(n: usize) -> Arg {
    Arg::int(A_COUNT, i64::try_from(n).unwrap_or(i64::MAX))
}

/// Le righe, al più [`DAY_ROWS`], e la riga che conta le altre (`more`).
fn rows(items: Vec<UiNode>, total: usize, more: &str) -> Vec<UiNode> {
    let shown = items.len();
    let mut out = vec![UiNode::list(items)];
    if total > shown {
        out.push(UiNode::text(Text::message(
            more,
            vec![count(total - shown)],
        )));
    }
    out
}

fn open(doc: &DocId) -> Option<ActionRef> {
    Some(ActionRef::with(
        DAY_OPEN,
        serde_json::json!({ DOC: doc.as_str() }),
    ))
}

// ---------------------------------------------------------------------------
// Compiti di oggi
// ---------------------------------------------------------------------------

/// Un compito aperto che scade quel giorno: il testo e la nota.
#[derive(Debug, PartialEq, Eq)]
pub(in crate::template) struct DueTask {
    pub(in crate::template) doc: DocId,
    pub(in crate::template) at: usize,
    pub(in crate::template) text: String,
}

/// I compiti aperti di un modello che scadono il giorno `day` (giorni
/// dall'epoca), in qualunque punto dell'albero: liste annidate, citazioni e
/// blocchi custom, come li cammina la ricerca.
pub(in crate::template) fn due_on(model: &DocumentModel, doc: &DocId, day: i64) -> Vec<DueTask> {
    let mut found = Vec::new();
    let mut pending: Vec<&Block> = model.body.iter().rev().collect();
    while let Some(block) = pending.pop() {
        match block {
            Block::List { items, .. } => {
                for item in items.iter().rev() {
                    pending.extend(item.blocks.iter().rev());
                }
                for item in items {
                    let Some(marker) = item.task else { continue };
                    if marker.checked() {
                        continue;
                    }
                    let text = task_text(&item.blocks);
                    let Some(due) = task_due(&text) else { continue };
                    if due.day != Some(day) {
                        continue;
                    }
                    // Il testo senza la scadenza: il gruppo dice già il giorno.
                    let before = text[..due.from].trim_end();
                    let after = text[due.to..].trim_start();
                    let label = match (before.is_empty(), after.is_empty()) {
                        (_, true) => before.to_string(),
                        (true, false) => after.to_string(),
                        (false, false) => format!("{before} {after}"),
                    };
                    found.push(DueTask {
                        doc: doc.clone(),
                        at: marker.span.start,
                        text: label,
                    });
                }
            }
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => {
                pending.extend(blocks.iter().rev())
            }
            _ => {}
        }
    }
    found.sort_by_key(|task| task.at);
    found
}

fn tasks_group(host: &dyn ReadApi, date: &str, is_today: bool) -> Result<UiNode, PluginError> {
    let (title_key, bare_key) = if is_today {
        (DAY_TASKS_TODAY, DAY_TASKS_TODAY_BARE)
    } else {
        (DAY_TASKS_OTHER, DAY_TASKS_OTHER_BARE)
    };
    let bound = DueBound {
        date: date.to_string(),
        inclusive: true,
    };
    let answer = host.query_index(IndexQuery::Documents {
        matching: QueryExpr::of(QueryPredicate::TaskDue {
            min: Some(bound.clone()),
            max: Some(bound),
        }),
        sort: None,
        select: PropertySelect::None,
        page: Some(Page {
            offset: 0,
            limit: DAY_TASK_NOTES,
        }),
        excerpts: Excerpts::Omit,
    });
    let notes = match answer.and_then(IndexResult::documents) {
        Ok(notes) => notes,
        // La scadenza dei compiti la valuta l'indice di ricerca: spento lui,
        // il gruppo lo dice, e gli altri due funzionano.
        Err(PluginError::Unserved(_)) => {
            return Ok(group(
                KEY_TASKS,
                Text::key(bare_key),
                vec![UiNode::text(Text::key(DAY_TASKS_UNSERVED))],
            ));
        }
        // Un altro guasto dell'indice resta nel gruppo: la pagina mostra
        // comunque gli altri due, e il prossimo evento dell'indice riprova.
        Err(_) => {
            return Ok(group(
                KEY_TASKS,
                Text::key(bare_key),
                vec![UiNode::text(Text::key(DAY_TASKS_FAILED))],
            ));
        }
    };
    let Some(day) = civil_day(date) else {
        return Ok(UiNode::column(0, Vec::new()));
    };
    let mut tasks = Vec::new();
    for found in &notes.items {
        // Una nota che non si legge più (cestinata fra la domanda e la
        // lettura) non ha compiti da mostrare: non è un errore della pagina.
        if let Ok(model) = host.read_model(&found.doc) {
            tasks.extend(due_on(&model, &found.doc, day));
        }
    }
    tasks.sort_by(|a, b| a.doc.cmp(&b.doc).then(a.at.cmp(&b.at)));
    let total = tasks.len();
    let mut children = if total == 0 {
        vec![UiNode::empty_state(Text::key(DAY_TASKS_NONE))]
    } else {
        rows(
            tasks
                .iter()
                .take(DAY_ROWS)
                .map(|task| {
                    UiNode::list_item(
                        Text::from(task.text.clone()),
                        Some(Text::from(file_name(&task.doc))),
                        open(&task.doc),
                    )
                    .with_key(format!("{}#{}", task.doc.as_str(), task.at))
                })
                .collect(),
            total,
            DAY_TASKS_MORE,
        )
    };
    // Oltre il tetto delle note lette i compiti non si contano: si dice
    // quante note restano, che è ciò che si sa senza leggerle.
    let unread = (notes.total as usize).saturating_sub(notes.items.len());
    if unread > 0 && total > 0 {
        children.push(UiNode::text(Text::message(
            DAY_TASKS_UNREAD,
            vec![count(unread)],
        )));
    }
    Ok(group(
        KEY_TASKS,
        Text::message(title_key, vec![count(total)]),
        children,
    ))
}

// ---------------------------------------------------------------------------
// Stesso giorno
// ---------------------------------------------------------------------------

/// Il giorno scritto di una data, `AAAA-MM-GG`.
fn day_of(date: &fub_abi::model::PropertyDate) -> String {
    format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
}

/// Il valore porta questo giorno, da solo o dentro un elenco?
pub(in crate::template) fn has_day(value: &PropertyValue, day: &str) -> bool {
    match value {
        PropertyValue::Date(date) => day_of(date) == day,
        PropertyValue::List(items) => items
            .iter()
            .any(|item| matches!(item, PropertyScalar::Date(date) if day_of(date) == day)),
        _ => false,
    }
}

fn same_day_group(host: &dyn ReadApi, doc: &DocId, date: &str) -> Result<UiNode, PluginError> {
    // Le chiavi non si sanno prima (`date`, `created`, `scadenza`…): si
    // leggono le proprietà dall'indice e si guarda il valore già tipato.
    let documents = host
        .query_index(IndexQuery::Documents {
            matching: QueryExpr::all(),
            sort: None,
            select: PropertySelect::All,
            page: None,
            excerpts: Excerpts::Omit,
        })?
        .documents()?;
    let mut found: Vec<(DocId, Vec<String>)> = documents
        .items
        .into_iter()
        .filter(|m| &m.doc != doc)
        .filter_map(|m| {
            let keys: Vec<String> = m
                .properties
                .into_iter()
                .filter(|p| has_day(&p.value, date))
                .map(|p| p.key)
                .collect();
            (!keys.is_empty()).then_some((m.doc, keys))
        })
        .collect();
    found.sort_by(|a, b| a.0.cmp(&b.0));
    let total = found.len();
    let children = if total == 0 {
        vec![UiNode::empty_state(Text::key(DAY_SAME_NONE))]
    } else {
        rows(
            found
                .iter()
                .take(DAY_ROWS)
                .map(|(other, keys)| {
                    UiNode::list_item(
                        Text::from(file_name(other)),
                        Some(Text::from(keys.join(", "))),
                        open(other),
                    )
                    .with_key(other.as_str())
                })
                .collect(),
            total,
            DAY_MORE,
        )
    };
    Ok(group(
        KEY_SAME,
        Text::message(DAY_SAME, vec![count(total)]),
        children,
    ))
}

// ---------------------------------------------------------------------------
// Create e cambiate
// ---------------------------------------------------------------------------

fn changed_group(host: &dyn ReadApi, doc: &DocId, date: &str) -> Result<UiNode, PluginError> {
    let locale = host.user_locale();
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: Some(EntryKind::Document),
        within: None,
        page: None,
    })? {
        IndexResult::Entries(entries) => entries,
        other => {
            return Err(PluginError::Internal(
                format!(
                    "risposta fuori tema: attesa l'anagrafe, arrivato {}",
                    other.kind_name()
                )
                .into(),
            ))
        }
    };
    let year: i64 = date[..4].parse().unwrap_or_default();
    let month: u64 = date[5..7].parse().unwrap_or_default();
    let day: u64 = date[8..10].parse().unwrap_or_default();
    // Il giorno di una modifica è quello del fuso di chi guarda: una nota
    // salvata alle 23:30 a Roma è di quel giorno anche se in UTC è già domani.
    let mut found: Vec<(DocId, u64, String)> = Vec::new();
    for entry in entries.items {
        if &entry.id == doc {
            continue;
        }
        let (y, m, d, hh, mm) = civil_parts(entry.mtime, &locale)?;
        if (y, m, d) == (year, month, day) {
            found.push((
                entry.id,
                entry.mtime,
                format_time(hh, mm, locale.hour_cycle),
            ));
        }
    }
    // La più recente in cima; a parità, per nome.
    found.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let total = found.len();
    let children = if total == 0 {
        vec![UiNode::empty_state(Text::key(DAY_CHANGED_NONE))]
    } else {
        rows(
            found
                .iter()
                .take(DAY_ROWS)
                .map(|(other, _, time)| {
                    UiNode::list_item(
                        Text::from(file_name(other)),
                        Some(Text::message(
                            DAY_CHANGED_AT,
                            vec![Arg::text(A_TIME, time.clone())],
                        )),
                        open(other),
                    )
                    .with_key(other.as_str())
                })
                .collect(),
            total,
            DAY_MORE,
        )
    };
    Ok(group(
        KEY_CHANGED,
        Text::message(DAY_CHANGED, vec![count(total)]),
        children,
    ))
}

/// Le stringhe della pagina, in italiano.
pub(in crate::template) fn day_strings_it(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(DAY_TITLE, "La pagina del giorno")
        .with(DAY_DOC, "Giornaliera")
        .with(DAY_DATE, "Giorno")
        .with(DAY_TASKS_TODAY, "Compiti di oggi · {count}")
        .with(DAY_TASKS_OTHER, "Compiti del giorno · {count}")
        .with(DAY_TASKS_TODAY_BARE, "Compiti di oggi")
        .with(DAY_TASKS_OTHER_BARE, "Compiti del giorno")
        .with(DAY_TASKS_MORE, "E altri {count} compiti.")
        .with(
            DAY_TASKS_UNREAD,
            "Altre {count} note hanno compiti di questo giorno: li mostra la vista Compiti.",
        )
        .with(DAY_TASKS_NONE, "Nessun compito aperto scade in questo giorno.")
        .with(
            DAY_TASKS_UNSERVED,
            "La ricerca è spenta nei Componenti: senza di lei i compiti di questo giorno non si trovano.",
        )
        .with(
            DAY_TASKS_FAILED,
            "I compiti non si sono letti: l'indice non ha risposto. Riprovo al prossimo salvataggio.",
        )
        .with(DAY_SAME, "Stesso giorno · {count}")
        .with(DAY_SAME_NONE, "Nessuna nota ha questa data in una proprietà.")
        .with(DAY_CHANGED, "Create e cambiate · {count}")
        .with(DAY_CHANGED_NONE, "Nessuna nota è stata cambiata in questo giorno.")
        .with(DAY_CHANGED_AT, "Cambiata alle {time}")
        .with(DAY_MORE, "E altre {count} note.")
}

/// Le stringhe della pagina, in inglese.
pub(in crate::template) fn day_strings_en(catalog: StringCatalog) -> StringCatalog {
    catalog
        .with(DAY_TITLE, "The day page")
        .with(DAY_DOC, "Daily note")
        .with(DAY_DATE, "Day")
        .with(DAY_TASKS_TODAY, "Today's tasks · {count}")
        .with(DAY_TASKS_OTHER, "Tasks of the day · {count}")
        .with(DAY_TASKS_TODAY_BARE, "Today's tasks")
        .with(DAY_TASKS_OTHER_BARE, "Tasks of the day")
        .with(DAY_TASKS_MORE, "And {count} more tasks.")
        .with(
            DAY_TASKS_UNREAD,
            "{count} more notes have tasks for this day: the Tasks view shows them.",
        )
        .with(DAY_TASKS_NONE, "No open task is due on this day.")
        .with(
            DAY_TASKS_UNSERVED,
            "Search is off in Components: without it the tasks of this day can't be found.",
        )
        .with(
            DAY_TASKS_FAILED,
            "The tasks could not be read: the index did not answer. I'll retry at the next save.",
        )
        .with(DAY_SAME, "Same day · {count}")
        .with(DAY_SAME_NONE, "No note has this date in a property.")
        .with(DAY_CHANGED, "Created and changed · {count}")
        .with(DAY_CHANGED_NONE, "No note was changed on this day.")
        .with(DAY_CHANGED_AT, "Changed at {time}")
        .with(DAY_MORE, "And {count} more notes.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::format::ParseContext;
    use fub_abi::locale::Locale;
    use fub_abi::text::ArgValue;
    use fub_abi::{FormatProvider, VaultRead};
    use fub_sdk::testing::MemoryHost;

    /// Il banco dice 2023-11-14 22:13:20 UTC (il suo orologio fisso).
    const DAILY: &str = "Daily/2023-11-14.md";
    const DAY: &str = "2023-11-14";

    fn model(id: &str, source: &str) -> DocumentModel {
        fub_format_markdown::MarkdownProvider::new()
            .parse(&source.into(), &ParseContext::obsidian(id))
            .unwrap()
    }

    /// Un host con queste note, ognuna col suo modello: il frontmatter delle
    /// proprietà il doppio lo legge dai modelli.
    fn host_with(notes: &[(&str, &str)]) -> MemoryHost {
        notes.iter().fold(MemoryHost::new(), |host, (id, source)| {
            host.with_document(id, source)
                .with_model(id, model(id, source))
        })
    }

    fn instance(doc: &str, date: &str) -> ViewInstance {
        ViewInstance::new(
            DAY_PAGE_VIEW,
            "embedded-1",
            serde_json::json!({ DOC: doc, DATE: date }),
        )
    }

    /// Un testo come si legge in un test: il letterale, o `<chiave n>` con
    /// gli argomenti in ordine.
    fn said(text: &Text) -> String {
        match text {
            Text::Literal(s) => s.clone(),
            Text::Message(m) => {
                let args: Vec<String> = m
                    .args
                    .iter()
                    .map(|arg| match &arg.value {
                        ArgValue::Text(s) => s.clone(),
                        ArgValue::Int(n) => n.to_string(),
                        other => format!("{other:?}"),
                    })
                    .collect();
                if args.is_empty() {
                    format!("<{}>", m.key)
                } else {
                    format!("<{} {}>", m.key, args.join(" "))
                }
            }
        }
    }

    /// Un gruppo come si legge: la chiave, il titolo e le sue righe, ognuna
    /// «titolo | sottotitolo» o la frase che dice.
    fn groups(root: &UiNode) -> Vec<(String, String, Vec<String>)> {
        let UiKind::Stack { children, .. } = &root.kind else {
            panic!("una colonna di gruppi")
        };
        children
            .iter()
            .map(|section| {
                let UiKind::Section {
                    title,
                    collapsed,
                    children,
                } = &section.kind
                else {
                    panic!("un gruppo è una sezione")
                };
                assert!(!collapsed, "i gruppi nascono aperti");
                let mut lines = Vec::new();
                for child in children {
                    match &child.kind {
                        UiKind::List { items } => {
                            for item in items {
                                let UiKind::ListItem {
                                    title, subtitle, ..
                                } = &item.kind
                                else {
                                    panic!("una riga")
                                };
                                lines.push(format!(
                                    "{} | {}",
                                    said(title),
                                    subtitle.as_ref().map(said).unwrap_or_default()
                                ));
                            }
                        }
                        UiKind::Text { content } => lines.push(said(content)),
                        UiKind::EmptyState { title, .. } => lines.push(said(title)),
                        other => panic!("nodo inatteso: {other:?}"),
                    }
                }
                (section.key.clone().unwrap_or_default(), said(title), lines)
            })
            .collect()
    }

    #[test]
    fn the_day_page_reads_the_three_groups_from_the_index() {
        let host = host_with(&[
            (DAILY, "# 14 novembre\n\nScritto oggi.\n"),
            ("Lista.md", "---\ngiorni: [2023-11-14, 2023-11-20]\n---\n"),
            ("Progetti/Mostra.md", "---\napertura: 2023-11-14\n---\n"),
            ("Altro.md", "---\ndate: 2023-11-15\n---\n"),
        ]);
        let root = day_page(&instance(DAILY, DAY), &host).unwrap();
        assert_eq!(
            groups(&root),
            [
                (
                    KEY_TASKS.to_string(),
                    // Il doppio non ha l'indice di ricerca che valuta le
                    // scadenze: il gruppo lo dice e gli altri due funzionano.
                    format!("<{DAY_TASKS_TODAY_BARE}>"),
                    vec![format!("<{DAY_TASKS_UNSERVED}>")],
                ),
                (
                    KEY_SAME.to_string(),
                    format!("<{DAY_SAME} 2>"),
                    vec![
                        "Lista | giorni".to_string(),
                        "Mostra | apertura".to_string()
                    ],
                ),
                (
                    KEY_CHANGED.to_string(),
                    format!("<{DAY_CHANGED} 3>"),
                    vec![
                        format!("Altro | <{DAY_CHANGED_AT} 22:13>"),
                        format!("Lista | <{DAY_CHANGED_AT} 22:13>"),
                        format!("Mostra | <{DAY_CHANGED_AT} 22:13>"),
                    ],
                ),
            ]
        );
        // Resa e non scritta: la giornaliera resta com'era.
        assert_eq!(
            host.read_document(&DocId::new(DAILY)).unwrap(),
            "# 14 novembre\n\nScritto oggi.\n"
        );
    }

    #[test]
    fn a_row_opens_its_note() {
        let mut action = UiAction::new(DAY_OPEN);
        action.payload = serde_json::json!({ DOC: "Progetti/Mostra.md" });
        assert_eq!(
            day_action(&action),
            ViewUpdate::Navigate {
                doc_id: "Progetti/Mostra.md".into()
            }
        );
        assert_eq!(day_action(&UiAction::new("altro")), ViewUpdate::None);
    }

    #[test]
    fn the_day_is_the_one_of_the_reader_time_zone() {
        // A Tokyo il banco è già il 15 alle 07:13: la giornaliera del 14 è di
        // ieri, e niente è cambiato quel giorno; quella del 15 è di oggi.
        let host = host_with(&[(DAILY, ""), ("Daily/2023-11-15.md", ""), ("Nota.md", "")])
            .with_locale(Locale {
                timezone: "Asia/Tokyo".into(),
                ..Locale::default()
            });
        let yesterday = groups(&day_page(&instance(DAILY, DAY), &host).unwrap());
        assert_eq!(yesterday[0].1, format!("<{DAY_TASKS_OTHER_BARE}>"));
        assert_eq!(yesterday[2].1, format!("<{DAY_CHANGED} 0>"));
        assert_eq!(yesterday[2].2, [format!("<{DAY_CHANGED_NONE}>")]);
        let today =
            groups(&day_page(&instance("Daily/2023-11-15.md", "2023-11-15"), &host).unwrap());
        assert_eq!(today[0].1, format!("<{DAY_TASKS_TODAY_BARE}>"));
        assert_eq!(
            today[2].2,
            [
                // Alla stessa ora, per percorso: `Daily/…` prima di `Nota.md`.
                format!("2023-11-14 | <{DAY_CHANGED_AT} 07:13>"),
                format!("Nota | <{DAY_CHANGED_AT} 07:13>"),
            ]
        );
    }

    #[test]
    fn a_note_that_is_not_that_daily_shows_nothing() {
        let host = host_with(&[(DAILY, ""), ("Note/2023-11-14.md", "")]);
        for (doc, date) in [
            ("Note/2023-11-14.md", DAY),
            (DAILY, "2023-11-15"),
            (DAILY, "2023-02-30"),
            ("Daily/2023-11-14", DAY),
            ("Daily.v2/2023-11-14", DAY),
        ] {
            let root = day_page(&instance(doc, date), &host).unwrap();
            assert!(
                matches!(&root.kind, UiKind::Stack { children, .. } if children.is_empty()),
                "{doc} {date}: {root:?}"
            );
        }
        let without = ViewInstance::new(DAY_PAGE_VIEW, "x", serde_json::Value::Null);
        let root = day_page(&without, &host).unwrap();
        assert!(matches!(&root.kind, UiKind::Stack { children, .. } if children.is_empty()));
    }

    #[test]
    fn a_thousand_notes_on_one_day_stop_at_the_ceiling() {
        let notes: Vec<(String, String)> = (0..DAY_ROWS + 950)
            .map(|n| {
                (
                    format!("Note/{n:04}.md"),
                    format!("---\nquando: {DAY}\n---\n"),
                )
            })
            .collect();
        let mut all: Vec<(&str, &str)> = notes
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        all.push((DAILY, ""));
        let host = host_with(&all);
        let found = groups(&day_page(&instance(DAILY, DAY), &host).unwrap());
        for (_, title, lines) in &found[1..] {
            assert!(title.ends_with(" 1000>"), "{title}");
            assert_eq!(lines.len(), DAY_ROWS + 1);
            assert_eq!(lines[DAY_ROWS], format!("<{DAY_MORE} 950>"));
        }
    }

    #[test]
    fn the_open_tasks_due_that_day_are_read_from_the_model() {
        let source = "- [ ] Chiama Anna 📅 2023-11-14\n\
                      - [x] Già fatto 📅 2023-11-14\n\
                      - [ ] Domani 📅 2023-11-15\n\
                      - voce\n  - [ ] Annidato 📅 2023-11-14 dopo\n\
                      \n> - [ ] Citato 📅 2023-11-14\n";
        let doc = DocId::new("Compiti.md");
        let found = due_on(&model("Compiti.md", source), &doc, civil_day(DAY).unwrap());
        let texts: Vec<&str> = found.iter().map(|task| task.text.as_str()).collect();
        assert_eq!(texts, ["Chiama Anna", "Annidato dopo", "Citato"]);
        assert!(found.windows(2).all(|pair| pair[0].at < pair[1].at));
    }

    #[test]
    fn the_strings_say_the_same_things_in_both_languages() {
        let it = day_strings_it(StringCatalog::new("it"));
        let en = day_strings_en(StringCatalog::new("en"));
        let keys = |c: &StringCatalog| c.entries.keys().cloned().collect::<Vec<_>>();
        assert_eq!(keys(&it), keys(&en));
    }
}
