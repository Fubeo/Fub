//! Verifica che la tabella canonica degli schemi su disco coincida con le
//! costanti `SchemaVersion` presenti nei sorgenti.
//!
//! Il controllo è bidirezionale:
//! - ogni riga deve puntare a una costante reale col valore dichiarato;
//! - ogni costante inclusa nel censimento deve avere una riga.
//!
//! Il documento viene incluso in compilazione: spostarlo senza aggiornare il
//! presidio rende il test rosso invece di lasciare un riferimento morto.

const DOC_PATH: &str = "docs/reference/schemas-on-disk.md";
const DOC: &str = include_str!("../../../docs/reference/schemas-on-disk.md");

const SOURCES: &[(&str, &str)] = &[
    (
        "crates/fub-host/src/vaults.rs",
        include_str!("../../fub-host/src/vaults.rs"),
    ),
    (
        "crates/fub-kernel/src/organization.rs",
        include_str!("../../fub-kernel/src/organization.rs"),
    ),
    (
        "crates/fub-kernel/src/viewstate.rs",
        include_str!("../../fub-kernel/src/viewstate.rs"),
    ),
    (
        "crates/fub-kernel/src/entries.rs",
        include_str!("../../fub-kernel/src/entries.rs"),
    ),
    (
        "crates/fub-kernel/src/settings.rs",
        include_str!("../../fub-kernel/src/settings.rs"),
    ),
    (
        "crates/fub-features/src/versioning.rs",
        include_str!("../../fub-features/src/versioning.rs"),
    ),
    (
        "crates/fub-features/src/search.rs",
        include_str!("../../fub-features/src/search.rs"),
    ),
    (
        "crates/fub-kernel/src/journal.rs",
        include_str!("../../fub-kernel/src/journal.rs"),
    ),
    (
        "crates/fub-kernel/src/drafts.rs",
        include_str!("../../fub-kernel/src/drafts.rs"),
    ),
    (
        "crates/fub-kernel/src/maintenance.rs",
        include_str!("../../fub-kernel/src/maintenance.rs"),
    ),
    (
        "crates/fub-kernel/src/vault.rs",
        include_str!("../../fub-kernel/src/vault.rs"),
    ),
];

#[derive(Debug)]
struct TableRow {
    schema: String,
    file: String,
    line: usize,
    today: u32,
}

fn table_rows() -> Vec<TableRow> {
    DOC.lines()
        .filter_map(|line| {
            let line = line.trim();
            if !line.starts_with('|') || !line.contains("](../../crates/") {
                return None;
            }

            let columns: Vec<&str> = line.split('|').map(str::trim).collect();
            if columns.len() < 6 {
                return None;
            }

            let (file, source_line) = columns[2]
                .split_once("[`")?
                .1
                .split_once("`]")?
                .0
                .rsplit_once(':')?;
            let line = source_line.parse().ok()?;
            let today = columns[3].trim_matches('*').parse().ok()?;

            Some(TableRow {
                schema: columns[1].to_string(),
                file: file.to_string(),
                line,
                today,
            })
        })
        .collect()
}

fn declared_versions(source: &str) -> Vec<(usize, u32)> {
    let mut versions = Vec::new();

    for (index, source_line) in source.lines().enumerate() {
        let line = source_line.trim();
        let rest = line.strip_prefix("pub").unwrap_or(line).trim_start();
        let rest = match rest.find(") const ") {
            Some(position) if rest.starts_with('(') => &rest[position + 8..],
            _ => match rest.strip_prefix("const ") {
                Some(rest) => rest,
                None => continue,
            },
        };

        let Some((_name, type_and_value)) = rest.split_once(": ") else {
            continue;
        };
        let Some((kind, value)) = type_and_value.split_once(" = ") else {
            continue;
        };
        if kind != "SchemaVersion" {
            continue;
        }

        let value = value.trim().trim_end_matches(';');
        let number = value
            .strip_prefix("SchemaVersion::new(")
            .and_then(|value| value.strip_suffix(')'))
            .unwrap_or_else(|| {
                panic!(
                    "riga {}: forma di `SchemaVersion` non riconosciuta: {source_line}",
                    index + 1
                )
            });
        let number = number.parse::<u32>().unwrap_or_else(|_| {
            panic!(
                "riga {}: il valore `{number}` non è un numero",
                index + 1
            )
        });

        versions.push((index + 1, number));
    }

    versions
}

fn source(file: &str) -> Option<&'static str> {
    SOURCES
        .iter()
        .find(|(candidate, _)| *candidate == file)
        .map(|(_, source)| *source)
}

#[test]
fn every_table_row_points_to_a_constant_that_exists(
) {
    let rows = table_rows();
    assert_eq!(
        rows.len(),
        SOURCES.len(),
        "{DOC_PATH}: attese {} righe di schema, lette {}",
        SOURCES.len(),
        rows.len()
    );

    for row in &rows {
        let source = source(&row.file).unwrap_or_else(|| {
            panic!(
                "{}: `{}` cita `{}` che non è incluso in SOURCES",
                DOC_PATH, row.schema, row.file
            )
        });
        let versions = declared_versions(source);
        let (_, value) = versions
            .iter()
            .find(|(line, _)| *line == row.line)
            .unwrap_or_else(|| {
                panic!(
                    "{}: `{}` indica {}:{}, ma le costanti sono alle righe {:?}",
                    DOC_PATH,
                    row.schema,
                    row.file,
                    row.line,
                    versions.iter().map(|(line, _)| *line).collect::<Vec<_>>()
                )
            });

        assert_eq!(
            *value, row.today,
            "{}: `{}` dichiara {}, il codice {} in {}:{}",
            DOC_PATH, row.schema, row.today, value, row.file, row.line
        );
    }
}

#[test]
fn every_version_constant_has_its_row_in_the_table() {
    let rows = table_rows();

    for (file, source) in SOURCES {
        for (line, value) in declared_versions(source) {
            assert!(
                rows.iter().any(|row| {
                    row.file == *file && row.line == line && row.today == value
                }),
                "{}: {}:{} dichiara la versione {}, ma la tabella non la contiene",
                DOC_PATH,
                file,
                line,
                value
            );
        }
    }
}
