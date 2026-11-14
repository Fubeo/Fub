//! Le righe di un recinto ```` ```tasks ````, come le scrive il plugin Tasks di
//! Obsidian, lette dalla vista dei compiti.
//!
//! Ogni riga capita **restringe** la lista (valgono tutte insieme, come nel
//! plugin). Le righe capite:
//!
//! | Riga | Cosa tiene |
//! |---|---|
//! | `not done` | i compiti aperti |
//! | `done` | i compiti fatti |
//! | `due before <data>`, `due after <data>`, `due on <data>`, `due <data>` | i compiti con la scadenza prima, dopo o in quel giorno |
//! | `path includes <testo>` | i compiti delle note il cui percorso contiene il testo, lettera per lettera |
//! | `tag includes <tag>`, `tags include <tag>` | i compiti col tag o con un suo figlio |
//! | `sort by due`, `sort by path` (anche `reverse`) | l'ordine |
//! | `limit <n>`, `limit to <n> tasks` | quanti al più |
//!
//! La data è `AAAA-MM-GG`, `today`, `tomorrow` o `yesterday`. Le righe vuote e
//! quelle che iniziano con `#` non contano; ogni altra riga si salta e si dice.
//!
//! # Chi decide
//!
//! La domanda all'indice ([`TasksQuery::matching`]) **stringe** le note da
//! leggere e basta: a decidere quali compiti restano è [`TasksQuery::keeps`],
//! sul compito letto dal modello. Così il testo del percorso resta letterale (un
//! `*` non diventa un glob), il tag è quello del compito e non della nota, e una
//! scadenza conta anche per un compito fatto — che l'indice non indicizza.

use fub_abi::model::canonical_tag;
use fub_abi::query::{DueBound, QueryClause, QueryExpr, QueryLiteral, QueryPredicate, TaskStatus};
use fub_abi::rules::tag::is_sub_tag;
use fub_abi::rules::tasks::{civil_day, iso_day};

use super::{Due, Task};

/// Che stato chiedono le righe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Status {
    /// Nessuna riga sullo stato: aperti e fatti, come il plugin.
    Any,
    Open,
    Done,
    /// `not done` e `done` insieme: nessun compito è le due cose.
    Neither,
}

/// Una riga sulla scadenza.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum DueTest {
    Before(i64),
    After(i64),
    On(i64),
}

/// L'ordine chiesto.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum SortKey {
    /// Per scadenza (senza data in fondo), poi per nota e posizione.
    #[default]
    Due,
    /// Per nota e posizione.
    Path,
}

/// Una riga che non si è capita: il numero (da 1) e il testo.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Skipped {
    pub(super) line: usize,
    pub(super) text: String,
}

/// Le righe di un recinto, lette.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct TasksQuery {
    pub(super) status: Status,
    pub(super) due: Vec<DueTest>,
    /// I testi di `path includes`, in minuscolo.
    pub(super) paths: Vec<String>,
    /// I tag di `tag includes`, in forma canonica.
    pub(super) tags: Vec<String>,
    pub(super) sort: SortKey,
    pub(super) reverse: bool,
    pub(super) limit: Option<usize>,
    pub(super) skipped: Vec<Skipped>,
}

impl TasksQuery {
    /// Nessuna riga che scelga dei compiti: solo commenti, righe vuote, righe
    /// saltate, o soltanto ordine e limite. Un recinto così non mostra tutto il
    /// vault: dice come si scrive.
    pub(super) fn selects_nothing(&self) -> bool {
        self.status == Status::Any
            && self.due.is_empty()
            && self.paths.is_empty()
            && self.tags.is_empty()
    }

    /// Le note da leggere: quelle con un compito nello stato chiesto, e i tag e
    /// la scadenza che l'indice sa dire. `None` quando nessun compito può
    /// rispondere (`not done` con `done`).
    pub(super) fn matching(&self) -> Option<QueryExpr> {
        let statuses: &[TaskStatus] = match self.status {
            Status::Any => &[TaskStatus::Open, TaskStatus::Done],
            Status::Open => &[TaskStatus::Open],
            Status::Done => &[TaskStatus::Done],
            Status::Neither => return None,
        };
        let literal = |predicate| QueryLiteral {
            negated: false,
            predicate,
        };
        let any = statuses
            .iter()
            .map(|status| {
                let mut all = vec![literal(QueryPredicate::Task { status: *status })];
                for tag in &self.tags {
                    all.push(literal(QueryPredicate::Tag {
                        name: tag.clone(),
                        descendants: true,
                    }));
                }
                // L'indice tiene le scadenze dei soli compiti aperti: per i
                // fatti la scadenza la guarda `keeps`, sul modello.
                if *status == TaskStatus::Open {
                    for test in &self.due {
                        all.push(literal(due_predicate(*test)));
                    }
                }
                QueryClause { all }
            })
            .collect();
        Some(QueryExpr { any })
    }

    /// Il compito risponde a tutte le righe?
    pub(super) fn keeps(&self, task: &Task) -> bool {
        let status = match self.status {
            Status::Any => true,
            Status::Open => !task.checked,
            Status::Done => task.checked,
            Status::Neither => false,
        };
        status
            && self.due.iter().all(|test| match (task.due, test) {
                (Due::Day(day), DueTest::Before(limit)) => day < *limit,
                (Due::Day(day), DueTest::After(limit)) => day > *limit,
                (Due::Day(day), DueTest::On(limit)) => day == *limit,
                (Due::None | Due::Unreadable, _) => false,
            })
            && self
                .paths
                .iter()
                .all(|part| task.doc.as_str().to_lowercase().contains(part.as_str()))
            && self.tags.iter().all(|wanted| {
                task.tags
                    .iter()
                    .any(|tag| tag == wanted || is_sub_tag(tag, wanted))
            })
    }

    /// Mette i compiti nell'ordine chiesto.
    pub(super) fn sort(&self, tasks: &mut [Task]) {
        let path = |task: &Task| (task.doc.as_str().to_string(), task.at);
        match self.sort {
            SortKey::Due => tasks.sort_by_cached_key(|task| {
                let day = match task.due {
                    Due::Day(day) => Some(if self.reverse { -day } else { day }),
                    Due::None | Due::Unreadable => None,
                };
                // Senza data in fondo, anche a rovescio: è il compito che non
                // ha un posto nel calendario, non il più lontano.
                (day.is_none(), day, path(task))
            }),
            SortKey::Path => {
                tasks.sort_by_cached_key(path);
                if self.reverse {
                    tasks.reverse();
                }
            }
        }
    }
}

fn due_predicate(test: DueTest) -> QueryPredicate {
    let bound = |day: i64, inclusive: bool| {
        Some(DueBound {
            date: iso_day(day),
            inclusive,
        })
    };
    match test {
        DueTest::Before(day) => QueryPredicate::TaskDue {
            min: None,
            max: bound(day, false),
        },
        DueTest::After(day) => QueryPredicate::TaskDue {
            min: bound(day, false),
            max: None,
        },
        DueTest::On(day) => QueryPredicate::TaskDue {
            min: bound(day, true),
            max: bound(day, true),
        },
    }
}

/// Una data del plugin: `AAAA-MM-GG`, `today`, `tomorrow`, `yesterday`.
fn day_of(word: &str, today: i64) -> Option<i64> {
    match word.to_lowercase().as_str() {
        "today" => Some(today),
        "tomorrow" => Some(today + 1),
        "yesterday" => Some(today - 1),
        _ => civil_day(word),
    }
}

/// Le parole di una riga, in minuscolo.
fn words(line: &str) -> Vec<String> {
    line.split_whitespace().map(str::to_lowercase).collect()
}

/// Legge le righe di un recinto. `today` è il giorno di chi guarda, in giorni
/// dall'epoca: è ciò che `today`, `tomorrow` e `yesterday` vogliono dire.
pub(super) fn parse(source: &str, today: i64) -> TasksQuery {
    let mut query = TasksQuery {
        status: Status::Any,
        due: Vec::new(),
        paths: Vec::new(),
        tags: Vec::new(),
        sort: SortKey::default(),
        reverse: false,
        limit: None,
        skipped: Vec::new(),
    };
    for (index, raw) in source.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if !understood(&mut query, line, today) {
            query.skipped.push(Skipped {
                line: index + 1,
                text: line.to_string(),
            });
        }
    }
    query
}

/// Applica una riga, se la capisce.
fn understood(query: &mut TasksQuery, line: &str, today: i64) -> bool {
    let words = words(line);
    let words: Vec<&str> = words.iter().map(String::as_str).collect();
    match words.as_slice() {
        ["not", "done"] => {
            query.status = match query.status {
                Status::Any | Status::Open => Status::Open,
                Status::Done | Status::Neither => Status::Neither,
            };
            true
        }
        ["done"] => {
            query.status = match query.status {
                Status::Any | Status::Done => Status::Done,
                Status::Open | Status::Neither => Status::Neither,
            };
            true
        }
        ["due", side, date] => {
            let Some(day) = day_of(date, today) else {
                return false;
            };
            let test = match *side {
                "before" => DueTest::Before(day),
                "after" => DueTest::After(day),
                "on" => DueTest::On(day),
                _ => return false,
            };
            query.due.push(test);
            true
        }
        ["due", date] => match day_of(date, today) {
            Some(day) => {
                query.due.push(DueTest::On(day));
                true
            }
            None => false,
        },
        ["path", "includes", ..] => {
            // Il testo dopo le due parole, com'è scritto: anche con spazi.
            let text = after_words(line, 2);
            if text.is_empty() {
                return false;
            }
            query.paths.push(text.to_lowercase());
            true
        }
        ["tag" | "tags", "include" | "includes", name] => {
            let name = canonical_tag(name.trim_start_matches('#'));
            if name.is_empty() {
                return false;
            }
            query.tags.push(name);
            true
        }
        ["sort", "by", key, rest @ ..] => {
            let reverse = match rest {
                [] => false,
                ["reverse"] => true,
                _ => return false,
            };
            query.sort = match *key {
                "due" => SortKey::Due,
                "path" => SortKey::Path,
                _ => return false,
            };
            query.reverse = reverse;
            true
        }
        ["limit", n] | ["limit", "to", n, "tasks" | "task"] => match n.parse::<usize>() {
            Ok(n) => {
                query.limit = Some(n);
                true
            }
            Err(_) => false,
        },
        _ => false,
    }
}

/// Ciò che segue le prime `n` parole di una riga, senza gli spazi ai capi.
fn after_words(line: &str, n: usize) -> &str {
    let mut rest = line.trim_start();
    for _ in 0..n {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        rest = rest[end..].trim_start();
    }
    rest.trim_end()
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::DocId;

    fn day(text: &str) -> i64 {
        civil_day(text).expect("una data")
    }

    fn task(doc: &str, checked: bool, due: Due, tags: &[&str]) -> Task {
        Task {
            doc: DocId::new(doc),
            at: 0,
            symbol: if checked { Some('x') } else { None },
            checked,
            text: String::new(),
            due,
            due_span: None,
            tags: tags.iter().map(|t| t.to_string()).collect(),
            revision: None,
        }
    }

    #[test]
    fn every_understood_line_and_the_skipped_ones() {
        let today = day("2026-08-19");
        let q = parse(
            "# un commento\n\nnot done\ndue before tomorrow\ndue after 2026-08-01\ndue on today\ndue 2026-08-20\npath includes Progetti/Fub *\ntags include #Lavoro\nsort by due reverse\nlimit to 5 tasks\ngroup by filename\ndue before mai\n",
            today,
        );
        assert_eq!(q.status, Status::Open);
        assert_eq!(
            q.due,
            vec![
                DueTest::Before(today + 1),
                DueTest::After(day("2026-08-01")),
                DueTest::On(today),
                DueTest::On(day("2026-08-20")),
            ]
        );
        assert_eq!(q.paths, vec!["progetti/fub *".to_string()]);
        assert_eq!(q.tags, vec!["lavoro".to_string()]);
        assert_eq!((q.sort, q.reverse, q.limit), (SortKey::Due, true, Some(5)));
        assert_eq!(
            q.skipped,
            vec![
                Skipped {
                    line: 12,
                    text: "group by filename".into()
                },
                Skipped {
                    line: 13,
                    text: "due before mai".into()
                },
            ]
        );
        assert!(!q.selects_nothing());
    }

    #[test]
    fn lines_that_choose_no_task_select_nothing() {
        let today = day("2026-08-19");
        for source in [
            "",
            "# solo un commento\n\n",
            "group by filename",
            "sort by due\nlimit 3",
        ] {
            assert!(parse(source, today).selects_nothing(), "{source:?}");
        }
        assert!(!parse("done", today).selects_nothing());
    }

    #[test]
    fn done_and_not_done_together_keep_nothing() {
        let q = parse("not done\ndone", 0);
        assert_eq!(q.status, Status::Neither);
        assert_eq!(q.matching(), None);
        assert!(!q.keeps(&task("a.md", false, Due::None, &[])));
        assert!(!q.keeps(&task("a.md", true, Due::None, &[])));
    }

    #[test]
    fn the_path_is_a_literal_part_and_not_a_glob() {
        let q = parse("path includes Fub/*", 0);
        assert!(q.keeps(&task("Progetti/fub/*note.md", false, Due::None, &[])));
        assert!(!q.keeps(&task("Progetti/Fub/note.md", false, Due::None, &[])));
        // L'indice non riceve il percorso: lo decide il compito.
        let expr = q.matching().expect("una domanda");
        assert!(expr
            .predicates()
            .all(|p| !matches!(p, QueryPredicate::Path { .. })));
    }

    #[test]
    fn a_due_line_holds_for_done_tasks_too() {
        let q = parse("done\ndue before 2026-08-19", 0);
        assert!(q.keeps(&task("a.md", true, Due::Day(day("2026-08-18")), &[])));
        assert!(!q.keeps(&task("a.md", true, Due::Day(day("2026-08-19")), &[])));
        assert!(!q.keeps(&task("a.md", true, Due::Unreadable, &[])));
        // Per i fatti l'indice non ha scadenze: la domanda non le chiede.
        let expr = q.matching().expect("una domanda");
        assert!(expr
            .predicates()
            .all(|p| !matches!(p, QueryPredicate::TaskDue { .. })));
    }

    #[test]
    fn a_tag_line_takes_the_tag_and_its_children() {
        let q = parse("tag includes #lavoro", 0);
        assert!(q.keeps(&task("a.md", false, Due::None, &["lavoro"])));
        assert!(q.keeps(&task("a.md", false, Due::None, &["lavoro/fub"])));
        assert!(!q.keeps(&task("a.md", false, Due::None, &["lavorone"])));
        assert!(!q.keeps(&task("a.md", false, Due::None, &[])));
    }

    #[test]
    fn sort_by_due_puts_the_undated_last_even_in_reverse() {
        let mut tasks = vec![
            task("c.md", false, Due::None, &[]),
            task("b.md", false, Due::Day(day("2026-08-20")), &[]),
            task("a.md", false, Due::Day(day("2026-08-18")), &[]),
        ];
        let docs = |tasks: &[Task]| {
            tasks
                .iter()
                .map(|t| t.doc.as_str().to_string())
                .collect::<Vec<_>>()
        };
        parse("not done\nsort by due", 0).sort(&mut tasks);
        assert_eq!(docs(&tasks), ["a.md", "b.md", "c.md"]);
        parse("not done\nsort by due reverse", 0).sort(&mut tasks);
        assert_eq!(docs(&tasks), ["b.md", "a.md", "c.md"]);
        parse("not done\nsort by path reverse", 0).sort(&mut tasks);
        assert_eq!(docs(&tasks), ["c.md", "b.md", "a.md"]);
    }
}
