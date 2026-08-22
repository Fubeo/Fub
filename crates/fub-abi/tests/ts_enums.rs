//! Le union di stringhe del mirror TypeScript, **emesse** dai tipi Rust
//! (decisione 0053).
//!
//! È il primo posto del contratto che non si scrive a mano.
//! `frontend/src/host/enums.generated.ts` non è un mirror: è un **derivato**,
//! e `frontend/src/host/contract.ts` lo ri-esporta tenendo accanto la prosa —
//! che è l'unica cosa, di quelle union, che non si deriva da niente.
//!
//! # Perché da Rust e non dal WIT
//!
//! Perché il WIT e l'IPC sono **due confini diversi con due forme diverse**, e
//! il TypeScript attraversa solo il secondo. `Event::Trouble` sull'IPC è
//! `{"type":"trouble","severity":…}` — serde, tag interno, `snake_case` — e nel
//! WIT è `trouble(event-trouble)`, con un record `event-trouble` che nel JSON
//! **non esiste affatto**. Un generatore TS che leggesse il WIT produrrebbe la
//! forma di un confine che questo mirror non attraversa mai. Il verbale è la
//! [decisione 0053](../../../docs/decisions/0053-il-contratto-ha-una-sorgente.md).
//!
//! # Cosa entra qui, e chi lo decide
//!
//! Tutti e soli gli `enum` **senza payload** dichiarati `pub` in
//! `fub-abi/src/*.rs`, letti da [`common::fieldless_enums`]. L'elenco non è
//! scritto da nessuna parte: è una **regola**, quindi un enum nuovo entra senza
//! che nessuno se ne ricordi e il file committato diventa stantio — cioè rosso.
//! È il criterio del §16.7 applicato al posto in cui il §16.5 chiedeva un
//! generatore.
//!
//! Gli enum **con** payload non stanno qui: la loro forma JSON dipende da
//! `tag`/`content`, dai campi e dai tipi annidati, e derivarla vorrebbe dire
//! riscrivere serde. Quelli restano a mano in `contract.ts`, presidiati dalla
//! fixture di `fub-features/tests/ts_mirror.rs` — che è la stessa risposta di
//! prima, per la parte in cui era la risposta giusta.
//!
//! # Come si rigenera
//!
//! ```sh
//! UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums
//! ```

mod common;

use common::{fieldless_enums, snake};

const HEADER: &str = "\
// FILE GENERATO — non modificare a mano.
//
// Le union di stringhe del contratto, emesse dagli `enum` senza payload di
// `fub-abi` (crates/fub-abi/tests/ts_enums.rs, decisione 0053). I casi e il
// loro ORDINE vengono dalla dichiarazione Rust; la forma delle stringhe è
// quella di serde (`rename_all = \"snake_case\"`), cioè quella che attraversa
// davvero l'IPC — non quella del WIT, che è un altro confine.
//
// La prosa di ognuna sta accanto alla sua ri-esportazione in `contract.ts`: qui
// non ci sono commenti perché qui non c'è niente che qualcuno abbia deciso.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums
";

/// La larghezza oltre la quale una union va a capo. Non è stile: è ciò che
/// rende l'emissione **deterministica**, cioè confrontabile.
const WRAP: usize = 96;

fn render() -> String {
    let mut enums = fieldless_enums();
    // Alfabetico: l'ordine dei tipi nel file non è dato (l'ordine dei *casi* sì),
    // e ordinarlo per file renderebbe il diff dipendente da dove si sposta un tipo.
    enums.sort_by(|a, b| a.name.cmp(&b.name));

    let mut out = String::from(HEADER);
    for and in &enums {
        let cases: Vec<String> = and
            .variants
            .iter()
            .map(|v| format!("\"{}\"", snake(v)))
            .collect();
        let one_line = format!("export type {} = {};", and.name, cases.join(" | "));
        out.push('\n');
        if one_line.len() <= WRAP {
            out.push_str(&one_line);
            out.push('\n');
        } else {
            out.push_str(&format!("export type {} =\n", and.name));
            for c in &cases {
                out.push_str(&format!("  | {c}\n"));
            }
            // Il `;` su una riga sua: così aggiungere un caso è una riga in più
            // e non una riga cambiata più una in più.
            out.push_str(";\n");
        }
    }
    out
}

fn path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/host/enums.generated.ts"
    ))
}

/// La differenza fra ciò che i tipi Rust dicono e ciò che è committato, riga per
/// riga. Restituisce `None` quando combaciano.
fn diff(emitted: &str, committed: &str) -> Option<String> {
    if emitted == committed {
        return None;
    }
    let a: Vec<&str> = emitted.lines().collect();
    let b: Vec<&str> = committed.lines().collect();
    let mut lines = Vec::new();
    for the in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(the).copied(), b.get(the).copied());
        if x != y {
            lines.push(format!(
                "  line {}: from Rust types `{}`, in file `{}`",
                the + 1,
                x.unwrap_or("(nothing)"),
                y.unwrap_or("(nothing)")
            ));
            if lines.len() == 12 {
                lines.push("  …".into());
                break;
            }
        }
    }
    Some(lines.join("\n"))
}

#[test]
fn mirror_unions_match_the_rust_types() {
    let emitted = render();
    let path = path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &emitted).expect("writes generated unions");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "generated unions missing ({}): {and}. Regenerate with \
             `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums`.",
            path.display()
        )
    });

    if let Some(lines) = diff(&emitted, &committed) {
        panic!(
            "`frontend/src/host/enums.generated.ts` is stale: a contract \
             enum changed without regenerating it.\n{lines}\n\nRegenerate with \
             `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums`."
        );
    }
}

/// Il presidio deve saper **fallire**, o essere verde non vuol dire niente.
///
/// È il gemello di `every_form_of_breakage_turns_red` di `wit_additivity.rs` e di
/// `wit_conformance_actually_fails_on_drift`: si prendono le quattro forme in
/// cui il file committato può divergere dai tipi Rust e si verifica che il
/// confronto le veda tutte e quattro. La quarta è quella che conta: **un
/// riordino** non cambia nessuna stringa, e sull'IPC non cambia niente — ma è
/// il discriminante del WIT, ed è la ragione per cui l'ordine dei casi si legge
/// dal sorgente invece di ordinarli.
#[test]
fn every_form_of_divergence_turns_red() {
    let base = render();
    let mutations: [(&str, String); 4] = [
        (
            "an extra case",
            base.replace(
                "export type HourCycle = \"h23\" | \"h12\";",
                "export type HourCycle = \"h23\" | \"h12\" | \"h11\";",
            ),
        ),
        (
            "a missing case",
            base.replace(
                "export type Severity = \"warning\" | \"failure\";",
                "export type Severity = \"warning\";",
            ),
        ),
        (
            "a renamed case (wrong `snake_case` by hand)",
            base.replace("\"dry_run\"", "\"dryRun\""),
        ),
        (
            "two reordered cases (no string changes, the discriminant does)",
            base.replace(
                "export type EntryKind = \"document\" | \"asset\" | \"unknown\";",
                "export type EntryKind = \"asset\" | \"document\" | \"unknown\";",
            ),
        ),
    ];

    for (what, mutated) in mutations {
        assert_ne!(base, mutated, "mutation «{what}» changed nothing");
        assert!(
            diff(&base, &mutated).is_some(),
            "«{what}» did not make the comparison red"
        );
    }
}

/// E l'emissione deve essere **stabile**: un file che cambia da sola una
/// esecuzione all'altra renderebbe il presidio rumore, e lo si spegnerebbe.
#[test]
fn the_emission_is_deterministic() {
    assert_eq!(render(), render());
}
