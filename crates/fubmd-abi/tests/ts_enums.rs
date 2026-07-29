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
//! `fubmd-abi/src/*.rs`, letti da [`common::fieldless_enums`]. L'elenco non è
//! scritto da nessuna parte: è una **regola**, quindi un enum nuovo entra senza
//! che nessuno se ne ricordi e il file committato diventa stantio — cioè rosso.
//! È il criterio del §16.7 applicato al posto in cui il §16.5 chiedeva un
//! generatore.
//!
//! Gli enum **con** payload non stanno qui: la loro forma JSON dipende da
//! `tag`/`content`, dai campi e dai tipi annidati, e derivarla vorrebbe dire
//! riscrivere serde. Quelli restano a mano in `contract.ts`, presidiati dalla
//! fixture di `fubmd-features/tests/ts_mirror.rs` — che è la stessa risposta di
//! prima, per la parte in cui era la risposta giusta.
//!
//! # Come si rigenera
//!
//! ```sh
//! UPDATE_MIRROR=1 cargo test -p fubmd-abi --test ts_enums
//! ```

mod common;

use common::{fieldless_enums, snake};

const HEADER: &str = "\
// FILE GENERATO — non modificare a mano.
//
// Le union di stringhe del contratto, emesse dagli `enum` senza payload di
// `fubmd-abi` (crates/fubmd-abi/tests/ts_enums.rs, decisione 0053). I casi e il
// loro ORDINE vengono dalla dichiarazione Rust; la forma delle stringhe è
// quella di serde (`rename_all = \"snake_case\"`), cioè quella che attraversa
// davvero l'IPC — non quella del WIT, che è un altro confine.
//
// La prosa di ognuna sta accanto alla sua ri-esportazione in `contract.ts`: qui
// non ci sono commenti perché qui non c'è niente che qualcuno abbia deciso.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fubmd-abi --test ts_enums
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
    for e in &enums {
        let cases: Vec<String> = e
            .variants
            .iter()
            .map(|v| format!("\"{}\"", snake(v)))
            .collect();
        let one_line = format!("export type {} = {};", e.name, cases.join(" | "));
        out.push('\n');
        if one_line.len() <= WRAP {
            out.push_str(&one_line);
            out.push('\n');
        } else {
            out.push_str(&format!("export type {} =\n", e.name));
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
    let mut righe = Vec::new();
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied(), b.get(i).copied());
        if x != y {
            righe.push(format!(
                "  riga {}: dai tipi Rust `{}`, nel file `{}`",
                i + 1,
                x.unwrap_or("(niente)"),
                y.unwrap_or("(niente)")
            ));
            if righe.len() == 12 {
                righe.push("  …".into());
                break;
            }
        }
    }
    Some(righe.join("\n"))
}

#[test]
fn le_union_del_mirror_sono_quelle_dei_tipi_rust() {
    let emitted = render();
    let path = path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &emitted).expect("scrive le union generate");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "union generate mancanti ({}): {e}. Rigenerale con \
             `UPDATE_MIRROR=1 cargo test -p fubmd-abi --test ts_enums`.",
            path.display()
        )
    });

    if let Some(righe) = diff(&emitted, &committed) {
        panic!(
            "`frontend/src/host/enums.generated.ts` è stantio: un enum del \
             contratto è cambiato senza rigenerarlo.\n{righe}\n\nRigenera con \
             `UPDATE_MIRROR=1 cargo test -p fubmd-abi --test ts_enums`."
        );
    }
}

/// Il presidio deve saper **fallire**, o essere verde non vuol dire niente.
///
/// È il gemello di `ogni_forma_di_rottura_e_rossa` di `wit_additivity.rs` e di
/// `wit_conformance_actually_fails_on_drift`: si prendono le quattro forme in
/// cui il file committato può divergere dai tipi Rust e si verifica che il
/// confronto le veda tutte e quattro. La quarta è quella che conta: **un
/// riordino** non cambia nessuna stringa, e sull'IPC non cambia niente — ma è
/// il discriminante del WIT, ed è la ragione per cui l'ordine dei casi si legge
/// dal sorgente invece di ordinarli.
#[test]
fn ogni_forma_di_divergenza_e_rossa() {
    let base = render();
    let mutazioni: [(&str, String); 4] = [
        (
            "un caso in più",
            base.replace(
                "export type HourCycle = \"h23\" | \"h12\";",
                "export type HourCycle = \"h23\" | \"h12\" | \"h11\";",
            ),
        ),
        (
            "un caso in meno",
            base.replace(
                "export type Severity = \"warning\" | \"failure\";",
                "export type Severity = \"warning\";",
            ),
        ),
        (
            "un caso rinominato (il `snake_case` sbagliato a mano)",
            base.replace("\"dry_run\"", "\"dryRun\""),
        ),
        (
            "due casi riordinati (nessuna stringa cambia, il discriminante sì)",
            base.replace(
                "export type EntryKind = \"document\" | \"asset\" | \"unknown\";",
                "export type EntryKind = \"asset\" | \"document\" | \"unknown\";",
            ),
        ),
    ];

    for (cosa, mutata) in mutazioni {
        assert_ne!(base, mutata, "la mutazione «{cosa}» non ha toccato nulla");
        assert!(
            diff(&base, &mutata).is_some(),
            "«{cosa}» non ha reso rosso il confronto"
        );
    }
}

/// E l'emissione deve essere **stabile**: un file che cambia da sola una
/// esecuzione all'altra renderebbe il presidio rumore, e lo si spegnerebbe.
#[test]
fn l_emissione_e_deterministica() {
    assert_eq!(render(), render());
}
