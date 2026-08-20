//! **I formati su disco sono quelli dichiarati** (§15.3).
//!
//! Ogni file che Fub scrive porta il suo numero di versione, e
//! [`docs/versionamento.md`](../../../docs/versionamento.md) ne tiene la
//! tabella: quale schema, in quale sorgente, a che numero è oggi. È l'elenco
//! che qualcuno legge il giorno in cui deve capire perché un file dell'utente
//! non si apre più — e fino a questo test era un elenco **tenuto a mano**.
//!
//! Cosa succedeva a tenerlo a mano, misurato il giorno in cui il test è nato:
//! la tabella dichiarava **nove** schemi mentre il codice ne aveva **dieci**
//! (`DIAGNOSTICS_VERSION`, nato con il suo campo e con il commento «§15.3» già
//! scritto accanto, non ci era mai entrato), e **cinque righe su nove**
//! puntavano a un numero di riga che il sorgente si era lasciato indietro. Un
//! puntatore sbagliato in un documento del genere non è un fastidio
//! tipografico: manda chi cerca la regola a leggerne un'altra.
//!
//! **Perché non basta `check-doc-links`.** Quei link scrivono il numero di riga
//! nel *testo* — `` [`crates/…/vaults.rs:40`](…) `` — e non nel frammento
//! dell'URL, e sono fra i link «senza un nome accanto da cercare» che quello
//! script conta e non verifica. Qui il nome da cercare c'è, ed è preciso: alla
//! riga dichiarata deve esserci una costante di versione, e il suo valore deve
//! essere il numero scritto nella colonna *Oggi*.
//!
//! **Perché non basta un conto.** Il conto `schemi-su-disco` conta le costanti
//! nei sorgenti e `schemi-in-tabella` conta le righe della tabella:
//! insieme prendono un formato **nato** e mai documentato, che è il caso che
//! nessun `include_str!` può vedere — un file che il test non include è un file
//! di cui il test non sa niente. Ma due conti uguali non dicono che siano gli
//! stessi undici: quello lo dice questo test, riga per riga. È la lezione della
//! [0105](../../../docs/decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md)
//! applicata a un terzo caso — *il conto prende ciò che nessuno ha elencato, il
//! test prende ciò che è elencato male* — e nessuno dei due basta da solo.
//!
//! Il legame con i sorgenti è `include_str!` e non `std::fs`, come in
//! `lean_ipc.rs`: se un file si sposta, questo test **non compila**.

/// La tabella che questo test giudica: `## 3. Le versioni degli schemi su
/// disco`, in `docs/versionamento.md`.
const DOC: &str = include_str!("../../../docs/versionamento.md");

/// I sorgenti che la tabella cita. Un formato nuovo aggiunge una riga là e una
/// riga qui, e finché non fa tutt'e due il test lo dice per nome.
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

/// Una riga della tabella: lo schema, dove sta dichiarato, e a che numero è.
#[derive(Debug)]
struct TableRow {
    schema: String,
    file: String,
    line: usize,
    today: u32,
}

/// Legge la tabella degli schemi. Non è un parser di markdown: è la forma di
/// **quella** tabella, e una riga che non la rispetta viene ignorata — quindi
/// il verso «ogni costante ha la sua riga» è ciò che impedisce a una riga
/// scritta male di sparire in silenzio.
fn table_rows() -> Vec<TableRow> {
    let mut out = Vec::new();
    for line in DOC.lines() {
        let line = line.trim();
        if !line.starts_with('|') || !line.contains("](../crates/") {
            continue;
        }
        let cols: Vec<&str> = line.split('|').map(str::trim).collect();
        // `| schema | [`file:riga`](…) | oggi | cosa contiene |` → cinque
        // colonne più i due bordi vuoti.
        if cols.len() < 5 {
            continue;
        }
        let Some((file, number)) = cols[2]
            .split_once("[`")
            .and_then(|(_, rest)| rest.split_once("`]"))
            .and_then(|(inside, _)| inside.rsplit_once(':'))
        else {
            continue;
        };
        let Ok(number) = number.parse::<usize>() else {
            continue;
        };
        let Ok(today) = cols[3].trim_matches('*').parse::<u32>() else {
            continue;
        };
        out.push(TableRow {
            schema: cols[1].to_string(),
            file: file.to_string(),
            line: number,
            today,
        });
    }
    out
}

/// Le costanti di versione di un sorgente, per numero di riga.
///
/// Cerca la **proprietà**, e da questo giro la proprietà è il **tipo**: una
/// `const` di tipo [`SchemaVersion`](fub_abi::schema::SchemaVersion). Prima
/// cercava un intero il cui nome finisse per `VERSION`, ed era mezza sillaba
/// meglio del `const SCHEMA_VERSION` letterale da cui veniva — ma restava un
/// nome, e la 0106 aveva già misurato che un nome non regge: `DIAGNOSTICS_VERSION`
/// era sfuggita per un anno, e chi l'aveva chiamata così non aveva sbagliato
/// niente. Adesso una versione rinominata resta trovata, e un intero che si
/// chiama `VERSION` senza essere una versione di schema non entra più.
fn declared_versions(source: &str) -> Vec<(usize, u32)> {
    let mut out = Vec::new();
    for (the, line) in source.lines().enumerate() {
        let line = line.trim();
        // La visibilità non è la proprietà: `pub(crate) const` è la forma più
        // comune di questo codebase, e riconoscere solo `pub const` e `const`
        // avrebbe reso invisibile un formato che si era dichiarato per bene.
        let rest = line.strip_prefix("pub").unwrap_or(line).trim_start();
        let rest = match rest.find(") const ") {
            Some(the) if rest.starts_with('(') => &rest[the + 8..],
            _ => match rest.strip_prefix("const ") {
                Some(r) => r,
                None => continue,
            },
        };
        let Some((_name, type_and_value)) = rest.split_once(": ") else {
            continue;
        };
        let Some((typ, value)) = type_and_value.split_once(" = ") else {
            continue;
        };
        if typ != "SchemaVersion" {
            continue;
        }
        let value = value.trim().trim_end_matches(';');
        let number = value
            .strip_prefix("SchemaVersion::new(")
            .and_then(|v| v.strip_suffix(')'))
            .unwrap_or_else(|| {
                panic!(
                    "line {}: a `SchemaVersion` const written in a form this extractor cannot \
                     read:\n  {line}\n\
                     If the form is legitimate, widen the extractor — do not let an on-disk \
                     format vanish from a list that serves to see them all.",
                    the + 1
                )
            });
        let number: u32 = number
            .parse()
            .unwrap_or_else(|_| panic!("line {}: `{number}` is not a number", the + 1));
        out.push((the + 1, number));
    }
    out
}

fn source(file: &str) -> Option<&'static str> {
    SOURCES.iter().find(|(f, _)| *f == file).map(|(_, s)| *s)
}

#[test]
fn every_table_row_points_to_a_constant_that_exists() {
    let rows = table_rows();
    assert!(
        rows.len() >= 11,
        "the schema table has shrunk: {} rows read from \
         docs/versioning.md. If a format was removed it must be removed from \
         SOURCES too; if the table shape changed, this parser is the one that \
         is old.",
        rows.len()
    );
    for row in &rows {
        let Some(src) = source(&row.file) else {
            panic!(
                "\"{}\" cites {} that this test does not include: add it to SOURCES, \
                 otherwise that row is verified by nobody.",
                row.schema, row.file
            );
        };
        let versions = declared_versions(src);
        let Some((_, value)) = versions.iter().find(|(n, _)| *n == row.line) else {
            panic!(
                "\"{}\" says {}:{}, but there is no version constant there. \
                 That file's constants are at lines {:?}.",
                row.schema,
                row.file,
                row.line,
                versions.iter().map(|(n, _)| *n).collect::<Vec<_>>()
            );
        };
        assert_eq!(
            *value, row.today,
            "\"{}\": the table says {}, the code says {} ({}:{}). \
             The number that counts is the code's — it is the one that ends up \
             in user files.",
            row.schema, row.today, value, row.file, row.line
        );
    }
}

#[test]
fn every_version_constant_has_its_row_in_the_table() {
    let rows = table_rows();
    for (file, src) in SOURCES {
        for (number, value) in declared_versions(src) {
            let cited = rows
                .iter()
                .any(|r| r.file == *file && r.line == number && r.today == value);
            assert!(
                cited,
                "{}:{} declares version {} and no row of \
                 docs/versioning.md says so. An on-disk format not in the table \
                 is a format nobody will know how to migrate: the row costs less \
                 than the day it will be needed.",
                file,
                number,
                value
            );
        }
    }
}
