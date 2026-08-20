//! **Le due costanti di FNV-1a si scrivono in un posto solo.**
//!
//! Il posto è [`fub_abi::Fnv1a`], e ciò che presidia non è un'estetica: le tre
//! copie che c'erano prima — `Revision::of_bytes` nel contratto, `fingerprint`
//! nell'indice di ricerca, `fingerprint` nello store delle versioni — erano
//! ancora **uguali fra loro**, e questo era tutto il problema. Due di quei tre
//! numeri **finiscono su disco**: l'indice si rilegge a un avvio successivo, le
//! versioni pure, e il commento dello store dichiarava già di usare «la stessa
//! impronta che usa l'indice di ricerca» — cioè il contratto era scritto e la
//! copia che lo garantiva non c'era. Il giorno che una delle tre fosse cambiata,
//! i due archivi non si sarebbero più riletti e **nessun banco l'avrebbe
//! detto**, perché ogni copia resta coerente con sé stessa: chi impronta e chi
//! confronta sono la stessa riga. È il difetto 0223.
//!
//! # Perché un conto e non solo il compilatore
//!
//! Il compilatore la metà sua l'ha fatta: le due copie sono sparite e i loro
//! chiamanti passano da [`Fnv1a::new`]/[`Fnv1a::hash`]. Ma non può accorgersi
//! del **gesto che ricomincia** — un quarto posto che vuole un `u64` stabile e
//! si riscrive le sue due `const`, perché in quel momento sono due righe e
//! sembra più breve che importare un tipo. È la variante che nessuno elenca, e
//! quella la prende un conto.
//!
//! # Cosa guarda, e cosa gli sfugge — detto qui e non altrove
//!
//! Guarda ogni `.rs` sotto una cartella `src/`, ovunque nel repo (nessun elenco
//! di crate scritto a mano), e ci cerca le **due costanti** in esadecimale,
//! normalizzando via gli `_`: `0xcbf2_9ce4_8422_2325` e
//! `0xcbf29ce484222325` sono la stessa riga per questo conto, che è la sola
//! differenza di forma che `cargo fmt` lascia libera.
//!
//! Gli sfugge, ed è dichiarato: le stesse costanti scritte in decimale, o
//! costruite sommando, o prese da una dipendenza esterna che porta il suo FNV.
//! Sono tutte più lunghe da scrivere della chiamata giusta, ed è precisamente
//! su questo che la maglia larga tiene: intercetta il gesto comodo, che è
//! l'unico che qualcuno farà.
//!
//! Non salta i commenti: se un giorno una prosa nominasse una delle due
//! costanti per esteso, questo conto diventerebbe rosso. È il verso innocuo —
//! la si sposta qui, dove sta già scritta spezzata proprio per non presidiare
//! sé stessa.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Le due costanti che fanno di un ciclo un FNV-1a a 64 bit, senza `_` e in
/// minuscolo.
///
/// Scritte a pezzi — `"cbf29ce4" + "84222325"` — perché altrimenti questo
/// elenco sarebbe esso stesso una copia, e un presidio che si conta dentro è un
/// presidio che non si può spostare né citare.
fn constants() -> Vec<String> {
    vec![
        format!("0x{}{}", "cbf29ce4", "84222325"),
        format!("0x{}{}", "00000100", "000001b3"),
    ]
}

/// L'unico file di produzione autorizzato a contenerle: l'impronta vera.
///
/// Uno solo, e senza una struttura per le eccezioni: il giorno che ne servisse
/// un secondo la domanda da farsi è *perché due*, e la risposta va scritta
/// qui — non aggiunta a un elenco che cresce senza che nessuno se ne accorga.
const THE_FINGERPRINT: &str = "crates/fub-abi/src/edit.rs";

/// Le cartelle in cui non si entra.
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

/// La riga come la guarda il conto: niente `_`, tutto minuscolo.
fn normalize(line: &str) -> String {
    line.replace('_', "").to_lowercase()
}

/// Chi scrive una delle due costanti nel codice di produzione, e dove.
fn sites() -> Vec<String> {
    let needles = constants();
    let mut out = Vec::new();
    for (file, source) in production_sources() {
        if file == THE_FINGERPRINT {
            continue;
        }
        for (n, line) in source.lines().enumerate() {
            let flat = normalize(line);
            if needles.iter().any(|a| flat.contains(a.as_str())) {
                out.push(format!("{file}:{}   {}", n + 1, line.trim()));
            }
        }
    }
    out
}

#[test]
fn the_fnv_constants_live_in_a_single_file() {
    let found = sites();
    assert!(
        found.is_empty(),
        "{} production lines write an FNV-1a constant outside `{THE_FINGERPRINT}`:\n  {}\n\n\
         An extra fingerprint is a fingerprint that diverges, and diverges silently: these \
         numbers end up on disk, and whoever wrote them re-reads them with their own copy, \
         so it stays green until two archives need to talk to each other. Anyone wanting \
         the raw number should go through `fub_abi::Fnv1a` — `hash` for a single block, \
         `new`/`update`/`value` for a sequence of fields to separate.",
        found.len(),
        found.join("\n  ")
    );
}

/// Il test del test. `the_fnv_constants_live_in_a_single_file` è verde anche
/// se il cammino non trova niente e se il conto non aggancia, e le due avarie
/// sono indistinguibili da un repo pulito.
#[test]
fn the_walk_and_the_bench_match() {
    let sources = production_sources();
    assert!(
        sources.len() > 50,
        "only {} production sources found: the walker is not walking",
        sources.len()
    );
    let fingerprint = sources
        .get(THE_FINGERPRINT)
        .unwrap_or_else(|| panic!("`{THE_FINGERPRINT}` was not read by the walker"));

    // Le due costanti stanno lì, e stanno nella forma con gli `_` che `cargo
    // fmt` produce: se il normalizzatore smettesse di togliere gli underscore,
    // qui ne vedrebbe zero e il conto vero non aggancerebbe più niente.
    let flat = normalize(fingerprint);
    for needle in constants() {
        assert!(
            flat.contains(&needle),
            "`{THE_FINGERPRINT}` no longer contains `{needle}`: the fingerprint has moved, \
             and this guard is looking at a file that is no longer its home"
        );
    }
    assert!(
        fingerprint.contains('_'),
        "`{THE_FINGERPRINT}` no longer writes the constants in groups: the normalizer is \
         no longer needed, and this check no longer proves anything"
    );
}
