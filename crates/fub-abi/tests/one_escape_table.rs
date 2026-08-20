//! **Nel codice di produzione le entità HTML si scrivono in un posto solo.**
//!
//! Il posto è [`attr::html`], e ciò che presidia non è un'estetica: le tre
//! tabelle che c'erano prima **erano già divergenti**. `fub-features` non
//! copriva l'apice, `fub-kernel` non copriva né l'apice né il maggiore, e le
//! tre stavano in tre crate che non si vedono fra loro — cioè nella condizione
//! in cui una correzione fatta su una non arriva mai alle altre. È il difetto
//! 0048 visto per intero: non «una riga da aggiungere in `blocks.rs`», ma un
//! sito su tre.
//!
//! # Perché un conto e non solo il compilatore
//!
//! Il compilatore la metà sua l'ha fatta: le due tabelle divergenti sono
//! sparite e i loro chiamanti passano da [`attr::html::attr`], che le
//! virgolette e l'escape li mette da sé. Ma il compilatore non può accorgersi
//! del **gesto che ricomincia** — un quarto emettitore di HTML che si scrive la
//! sua `fn escape_attr` privata, perché in quel momento è la cosa più breve da
//! fare. È la variante che nessuno ha elencato, e quella la prende un conto.
//!
//! # Cosa guarda, e cosa gli sfugge — detto qui e non altrove
//!
//! Guarda ogni `.rs` sotto una cartella `src/`, ovunque nel repo (nessun elenco
//! di crate scritto a mano), e ci cerca le **entità** — `&amp;`, `&lt;`,
//! `&gt;`, `&quot;`, `&#39;` — perché è l'unica cosa che una tabella di escape
//! deve contenere per funzionare, qualunque forma abbia: `match`, catena di
//! `replace`, array di coppie.
//!
//! Non guarda:
//!
//! - **la prosa.** Un commento che *racconta* questo difetto ne nomina le
//!   entità, e questo file ne è il primo esempio: senza il salto, il presidio
//!   presidierebbe se stesso.
//! - **i moduli `#[cfg(test)]` dentro i `src/`.** Un banco che asserisce
//!   `contains("&amp;")` sta verificando un'uscita, non costruendo una tabella.
//! - **i `tests/`.** Stessa ragione.
//!
//! Gli sfugge, ed è dichiarato: una tabella scritta coi code point
//! (`\u{26}amp;`), una costruita concatenando pezzi, e un escape che usa le
//! entità **nominate diverse** (`&apos;`, `&#x27;`). Sono tutte più lunghe da
//! scrivere della chiamata giusta, ed è precisamente su questo che la maglia
//! larga tiene: intercetta il gesto comodo, che è l'unico che qualcuno farà.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Le entità che una tabella di escape HTML deve contenere per essere una
/// tabella di escape HTML.
///
/// Scritte spezzate — `"&" + "amp;"` — perché altrimenti questo elenco sarebbe
/// esso stesso una tabella, e un presidio che si conta dentro è un presidio che
/// non si può spostare né citare.
fn entities() -> Vec<String> {
    ["amp;", "lt;", "gt;", "quot;", "#39;"]
        .iter()
        .map(|tail| format!("&{tail}"))
        .collect()
}

/// L'unico file di produzione autorizzato a contenerle: la tabella vera.
///
/// Uno solo, e senza una struttura per le eccezioni: il giorno che ne servisse
/// un secondo la domanda da farsi è *perché due*, e la risposta va scritta
/// qui — non aggiunta a un elenco che cresce senza che nessuno se ne accorga.
const THE_TABLE: &str = "crates/fub-abi/src/html.rs";

/// Folders we do not enter.
const EXCLUDED: &[&str] = &["target", "node_modules", ".git", ".fub"];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Ogni `.rs` sotto una cartella `src/`, per percorso relativo alla radice.
fn production_sources() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    walk(&root(), "", &mut out);
    out
}

fn walk(dir: &Path, rel: &str, out: &mut BTreeMap<String, String>) {
    let entries =
        std::fs::read_dir(dir).unwrap_or_else(|and| panic!("`{}` is unreadable: {and}", dir.display()));
    for entry in entries {
        let entry = entry.unwrap_or_else(|and| panic!("inside `{}`: {and}", dir.display()));
        let name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|n| panic!("non-UTF-8 file name: {n:?}"));
        let path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let kind = entry
            .file_type()
            .unwrap_or_else(|and| panic!("`{path}`: {and}"));
        if kind.is_dir() {
            if !EXCLUDED.contains(&name.as_str()) {
                walk(&entry.path(), &path, out);
            }
        } else if name.ends_with(".rs") && path.contains("/src/") {
            let src = std::fs::read_to_string(entry.path())
                .unwrap_or_else(|and| panic!("`{path}` is unreadable: {and}"));
            out.insert(path, src);
        }
    }
}

/// Le righe **di codice** di un sorgente, numerate a partire da 1: niente
/// commenti di riga, niente modulo di prova.
///
/// Il modulo di prova si riconosce nella sola forma che il repo usa —
/// `#[cfg(test)]` a colonna zero, `mod … {` sotto, e la prima `}` a colonna
/// zero — che tiene perché `cargo fmt --all --check` è verde. Una forma diversa
/// non salta niente, cioè conta di più: il verso innocuo.
fn code_lines(source: &str) -> Vec<(usize, &str)> {
    let lines: Vec<&str> = source.lines().collect();
    let mut out = Vec::new();
    let mut n = 0;
    while n < lines.len() {
        let line = lines[n];
        if line.trim_start().starts_with("//") {
            n += 1;
            continue;
        }
        if line == "#[cfg(test)]" && lines.get(n + 1).is_some_and(|r| r.starts_with("mod ")) {
            let end = lines
                .iter()
                .enumerate()
                .skip(n + 2)
                .find(|(_, r)| **r == "}")
                .map(|(the, _)| the)
                .unwrap_or(lines.len() - 1);
            n = end + 1;
            continue;
        }
        out.push((n + 1, line));
        n += 1;
    }
    out
}

/// Chi scrive un'entità HTML nel codice di produzione, e dove.
fn sites() -> Vec<String> {
    let needles = entities();
    let mut out = Vec::new();
    for (file, source) in production_sources() {
        if file == THE_TABLE {
            continue;
        }
        for (n, line) in code_lines(&source) {
            if needles.iter().any(|a| line.contains(a.as_str())) {
                out.push(format!("{file}:{n}   {}", line.trim()));
            }
        }
    }
    out
}

#[test]
fn html_entities_live_in_a_single_file() {
    let found = sites();
    assert!(
        found.is_empty(),
        "{} production lines write an HTML entity outside `{THE_TABLE}`:\n  {}\n\n\
         An extra escape table is a table that diverges: the three that existed before \
         covered different characters. Anyone emitting markup goes through \
         `fub_abi::html::escape` for text and `fub_abi::html::attr` for an attribute — \
         `attr` adds the quotes itself, so there is no escape to remember.",
        found.len(),
        found.join("\n  ")
    );
}

/// Il test del test. `html_entities_live_in_a_single_file` è verde anche se il
/// cammino non trova niente e se l'estrattore salta tutto, e le due avarie sono
/// indistinguibili da un repo pulito.
#[test]
fn the_walk_and_the_extractor_match() {
    let sources = production_sources();
    assert!(
        sources.len() > 50,
        "only {} production sources found: the walker is not walking",
        sources.len()
    );
    let table = sources
        .get(THE_TABLE)
        .unwrap_or_else(|| panic!("`{THE_TABLE}` was not read by the walker"));

    // Le entità nella tabella vera stanno nel *codice*, non nei suoi commenti:
    // se l'estrattore saltasse più del dovuto, qui ne vedrebbe zero.
    let in_code: Vec<&str> = code_lines(table)
        .into_iter()
        .filter(|(_, r)| entities().iter().any(|a| r.contains(a.as_str())))
        .map(|(_, r)| r)
        .collect();
    assert_eq!(
        in_code.len(),
        5,
        "expected five entities in the code of `{THE_TABLE}`, found {}:\n{in_code:#?}",
        in_code.len()
    );

    // E l'estrattore salta davvero il modulo di prova: `html.rs` ne ha uno che
    // le nomina tutte, e nessuna delle sue righe è finita nel conto qui sopra.
    assert!(
        table.contains("#[cfg(test)]"),
        "`{THE_TABLE}` no longer has a test module: this check no longer matches anything"
    );
}
