//! `TemplateView`: l'elenco dei template e il calendario delle note del giorno.

use super::*;

pub struct TemplateView;

impl ViewProvider for TemplateView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            refresh: EventMask::of([EventKind::IndexUpdated, EventKind::BatchEnded]),
            follows: ContextMask::default(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![
            ViewSpec::new(
                TEMPLATE_VIEW,
                Text::key(VIEW_TITLE),
                ViewSurface::LeftSidebar,
            )
            .with_icon("template")
            .ordered(4),
            ViewSpec::new(
                CALENDAR_VIEW,
                Text::key(CALENDAR_TITLE),
                ViewSurface::RightSidebar,
            )
            .with_icon("calendar")
            .ordered(7),
        ]
    }

    fn render_view(
        &self,
        instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        if instance.view == CALENDAR_VIEW {
            return calendar(host);
        }
        tree(host)
    }

    fn on_action(
        &mut self,
        instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        if instance.view == CALENDAR_VIEW {
            return calendar_action(action, host);
        }
        if action.action.0 != USE {
            return Ok(ViewUpdate::None);
        }
        let Some(template) = action.payload.get(TEMPLATE).and_then(|v| v.as_str()) else {
            return Ok(ViewUpdate::None);
        };
        match host.run_command(
            NOTES_FROM_TEMPLATE,
            serde_json::json!({ TEMPLATE: template }),
        ) {
            Ok(outcome) => match outcome.effect {
                CommandEffect::Navigate { doc } => Ok(ViewUpdate::Navigate {
                    doc_id: doc.as_str().to_string(),
                }),
                _ => Ok(ViewUpdate::Replace { root: tree(host)? }),
            },
            Err(and) => Ok(ViewUpdate::Replace {
                root: UiNode::failed(Text::from(and.to_string()), None),
            }),
        }
    }
}

/// Il mese che il calendario mostra: quello salvato nello stato di vista, o
/// quello di oggi.
fn shown_month(host: &dyn ReadApi) -> Result<i64, PluginError> {
    if let Some(index) = host.view_state(SHOWN)?.and_then(|v| v.as_i64()) {
        return Ok(index);
    }
    let today = today(host)?;
    let year: i64 = today[..4].parse().unwrap_or(1970);
    let month: i64 = today[5..7].parse().unwrap_or(1);
    Ok(year * 12 + month - 1)
}

/// Il giorno della settimana ISO (lunedì = 1) di un giorno dall'epoca, che era
/// un giovedì.
fn iso_weekday(day: i64) -> i64 {
    (day + 3).rem_euclid(7) + 1
}

/// Il numero ISO 8601 della settimana di un giorno: quella del suo giovedì,
/// contata dal primo giovedì dell'anno.
fn iso_week(day: i64) -> i64 {
    let thursday = day - iso_weekday(day) + 4;
    let (year, _, _) = civil_from_days(thursday);
    (thursday - days_from_civil(year, 1, 1)) / 7 + 1
}

/// Un mese di giornaliere: le righe sono settimane che cominciano dal primo
/// giorno della settimana del locale, con il numero ISO della settimana in
/// testa; un giorno che ha già la sua giornaliera è un bottone in evidenza.
///
/// La giornaliera di un giorno si riconosce dal path che `note.daily` le
/// darebbe, con cartella, formato ed estensione di adesso: una nota scritta
/// con un formato vecchio non c'è, come non la troverebbe il comando.
pub(super) fn calendar(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let index = shown_month(host)?;
    let (year, month) = (index.div_euclid(12), index.rem_euclid(12) as u64 + 1);
    let locale = host.user_locale();
    let language = locale.language_base().to_string();
    let first = days_from_civil(year, month, 1);
    let length = days_in_month(year, month) as i64;
    let start = i64::from(locale.first_day_of_week.iso());
    let offset = (iso_weekday(first) - start).rem_euclid(7);
    let weeks = (offset + length + 6) / 7;
    let existing: std::collections::HashSet<DocId> =
        host.list_documents(None)?.items.into_iter().collect();
    let folder = daily_folder(host);
    let format = daily_format(host);
    let extension = crate::formats::new_note_extension(host)?;
    let today = today(host)?;
    let weekdays = if language == "it" {
        WEEKDAYS_IT
    } else {
        WEEKDAYS_EN
    };
    let months = if language == "it" {
        MONTHS_IT
    } else {
        MONTHS_EN
    };
    let mut columns = vec![TableColumn::new(Text::key(CALENDAR_WEEK))];
    for d in 0..7 {
        let name = weekdays[((start - 1 + d) % 7) as usize];
        let short: String = name.chars().take(3).collect();
        let mut column = TableColumn::new(Text::from(short));
        column.align = Align::Center;
        columns.push(column);
    }
    let rows = (0..weeks)
        .map(|week| {
            let from = first - offset + 7 * week;
            // Il numero è quello del giovedì della riga, che con la settimana
            // da lunedì è la regola ISO e con quella da domenica (o da sabato)
            // dà alla riga la settimana ISO della maggior parte dei suoi giorni.
            let thursday = (from..from + 7)
                .find(|day| iso_weekday(*day) == 4)
                .unwrap_or(from);
            let mut cells = vec![UiNode::text(Text::from(iso_week(thursday).to_string()))];
            for d in 0..7 {
                let (y, m, day) = civil_from_days(from + d);
                if m != month {
                    cells.push(UiNode::text(Text::from(String::new())));
                    continue;
                }
                let date = format!("{y:04}-{m:02}-{day:02}");
                let name = daily_name(&format, &date, &language);
                let id = DocId::new(format!("{folder}/{name}.{extension}"));
                let intent = if existing.contains(&id) {
                    Intent::Primary
                } else {
                    Intent::Neutral
                };
                // Oggi si riconosce dal punto: il contratto non ha uno stato
                // «corrente» per un bottone, e il colore lo dice già la nota.
                let label = if date == today {
                    format!("{day}•")
                } else {
                    day.to_string()
                };
                cells.push(
                    UiNode::button(
                        Text::from(label),
                        intent,
                        ActionRef::with(CALENDAR_OPEN, serde_json::json!({ DATE: date })),
                    )
                    .with_key(date),
                );
            }
            UiNode::keyed(
                format!("week-{}", from),
                UiKind::Row {
                    cells,
                    action: None,
                },
            )
        })
        .collect();
    let title = format!("{} {year}", months[(month - 1) as usize]);
    Ok(UiNode::column(
        8,
        vec![
            UiNode::row(
                4,
                vec![
                    UiNode::button(
                        Text::key(CALENDAR_PREV),
                        Intent::Neutral,
                        ActionRef::with(CALENDAR_PREV, serde_json::Value::Null),
                    ),
                    UiNode::heading(3, Text::from(title)),
                    UiNode::button(
                        Text::key(CALENDAR_NEXT),
                        Intent::Neutral,
                        ActionRef::with(CALENDAR_NEXT, serde_json::Value::Null),
                    ),
                    UiNode::button(
                        Text::key(CALENDAR_TODAY),
                        Intent::Neutral,
                        ActionRef::with(CALENDAR_TODAY, serde_json::Value::Null),
                    ),
                ],
            )
            .with_key("calendar-bar"),
            UiNode::keyed(format!("month-{index}"), UiKind::Table { columns, rows }),
        ],
    ))
}

/// I gesti del calendario: si cambia mese ricordandolo nello stato di vista, e
/// un giorno apre (o crea) la sua giornaliera con `note.daily`, la stessa
/// strada della palette.
pub(super) fn calendar_action(
    action: UiAction,
    host: &mut dyn HostApi,
) -> Result<ViewUpdate, PluginError> {
    let step = match action.action.0.as_str() {
        CALENDAR_PREV => Some(-1),
        CALENDAR_NEXT => Some(1),
        CALENDAR_TODAY => {
            host.set_view_state(SHOWN, None)?;
            None
        }
        CALENDAR_OPEN => {
            let Some(date) = action.payload.get(DATE).and_then(|v| v.as_str()) else {
                return Ok(ViewUpdate::None);
            };
            return match host.run_command(NOTES_DAILY, serde_json::json!({ DATE: date })) {
                Ok(outcome) => match outcome.effect {
                    CommandEffect::Navigate { doc } => Ok(ViewUpdate::Navigate {
                        doc_id: doc.as_str().to_string(),
                    }),
                    _ => Ok(ViewUpdate::Replace {
                        root: calendar(host)?,
                    }),
                },
                Err(and) => Ok(ViewUpdate::Replace {
                    root: UiNode::failed(Text::from(and.to_string()), None),
                }),
            };
        }
        _ => return Ok(ViewUpdate::None),
    };
    if let Some(step) = step {
        let index = shown_month(host)? + step;
        host.set_view_state(SHOWN, Some(serde_json::json!(index)))?;
    }
    Ok(ViewUpdate::Replace {
        root: calendar(host)?,
    })
}

fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let prefix = format!("{FOLDER_TEMPLATES}/");
    let mut docs: Vec<DocId> = host
        .list_documents(None)?
        .items
        .into_iter()
        // Un template è testo da inserire in una nota: vale ogni formato il
        // cui sorgente è prosa, non la sola estensione `.md`.
        .filter(|d| {
            d.as_str().starts_with(&prefix)
                && crate::formats::understands(host, d, fub_abi::options::source::PROSE)
        })
        .collect();
    docs.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    if docs.is_empty() {
        return Ok(UiNode::empty_state(Text::key(EMPTY)));
    }
    Ok(UiNode::list(
        docs.into_iter()
            .map(|d| {
                let title = file_name(&d);
                UiNode::list_item(
                    Text::from(title),
                    Some(Text::from(d.as_str())),
                    Some(ActionRef::with(
                        USE,
                        serde_json::json!({ TEMPLATE: d.as_str() }),
                    )),
                )
                .with_key(d.0.clone())
            })
            .collect(),
    ))
}
