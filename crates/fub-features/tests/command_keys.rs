//! **Gli accordi dei comandi ufficiali, in una fixture che legge la shell.**
//!
//! I comandi di questa app stanno in due registri che si incontrano solo dentro
//! l'app in esecuzione: quelli del kernel, dichiarati qui e portati di là da
//! `list_commands`, e quelli della shell, dichiarati dai pannelli al montaggio.
//! Una scorciatoia è l'unica cosa che riguarda **entrambi** i registri insieme —
//! `Mod-Shift-f` era dichiarato da tutti e due, e nessuno dei due lati poteva
//! accorgersene. Il banco della shell aveva già la domanda giusta
//! (`conflitti(allCommands())`) e la faceva su metà dei dati, perché in un test
//! `allCommands()` vede solo il registro di là.
//!
//! Questa fixture è la metà che mancava: gli accordi del kernel scritti in un
//! JSON che il gemello vitest (`frontend/src/ui/keybindings.test.ts`) legge
//! insieme alla tabella `SHELL_KEYS`, per porre la domanda sui due registri
//! insieme. Il giro è quello di `ts_mirror.rs` e di `rules_mirror.rs` — genera
//! Rust, confronta il committato, `UPDATE_MIRROR=1` per rigenerare — e la
//! ragione per cui è ancora una fixture e non un import diretto è la stessa: i
//! due lati parlano lingue diverse e si incontrano solo su disco.
//!
//! Il verbale è la [0081](../../../docs/decisions/0081-un-accordo-ha-un-proprietario.md).
//!
//! # Cosa NON presidia
//!
//! I comandi dei **plugin**. Un plugin dichiara le proprie spec a runtime, e i
//! suoi accordi non possono stare in una fixture di compilazione: quel conflitto
//! lo trova `frasedeiConflitti` nella shell, che lo dice all'utente invece di
//! romperlo a chi scrive il codice. Qui stanno i comandi che spediamo noi, per i
//! quali un conflitto è un difetto e non una convivenza da segnalare.

use fub_features::commands::CoreCommands;
use serde_json::{Map, Value};

/// Ogni comando ufficiale con l'accordo che dichiara, `null` se non ne vuole.
///
/// Anche i `null`, e non solo gli accordi: un elenco dei soli comandi con
/// scorciatoia potrebbe svuotarsi fino a zero restando verde, e un presidio che
/// non può fallire è peggio di nessun presidio. Con tutti gli id dentro, la
/// fixture cambia ogni volta che cambia il registro — che è esattamente quando
/// vogliamo che qualcuno riguardi la domanda.
fn expected() -> Value {
    let mut out = Map::new();
    for spec in CoreCommands::specs() {
        out.insert(
            spec.id.clone(),
            match &spec.keybinding {
                Some(k) => Value::String(k.clone()),
                None => Value::Null,
            },
        );
    }
    Value::Object(out)
}

fn fixture_path() -> std::path::PathBuf {
    std::path::PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../frontend/src/__fixtures__/command-keys.json"
    ))
}

#[test]
fn command_keys_fixture_is_in_sync_with_the_command_registry() {
    let expected = expected();
    let path = fixture_path();

    // Rigenerazione esplicita: `UPDATE_MIRROR=1 cargo test -p fub-features
    // --test command_keys`. Fuori da quel caso il test non scrive mai nulla.
    if std::env::var_os("UPDATE_MIRROR").is_some() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("crea la cartella delle fixture");
        }
        let mut json = serde_json::to_string_pretty(&expected).expect("pretty");
        json.push('\n');
        std::fs::write(&path, json).expect("scrive la fixture");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "fixture degli accordi mancante ({}): {e}. Rigenerala con \
             `UPDATE_MIRROR=1 cargo test -p fub-features --test command_keys`.",
            path.display()
        )
    });
    let committed: Value = serde_json::from_str(&committed).expect("fixture JSON valida");

    assert_eq!(
        committed, expected,
        "la fixture degli accordi è stantia: il registro dei comandi è cambiato \
         senza rigenerarla. Rigenerala con `UPDATE_MIRROR=1 cargo test -p \
         fub-features --test command_keys`, poi lascia parlare \
         `frontend/src/ui/keybindings.test.ts`: se l'accordo nuovo è già di \
         qualcun altro, è là che diventa rosso."
    );
}

/// Il kernel non litiga con sé stesso.
///
/// Il gemello TS guarda i due registri insieme; questo guarda solo il nostro, e
/// serve perché un conflitto interno al kernel deve essere rosso **qui**, senza
/// aspettare che qualcuno lanci la suite di là.
#[test]
fn no_two_official_commands_want_the_same_chord() {
    let mut per_accordo: std::collections::HashMap<String, Vec<String>> = Default::default();
    for spec in CoreCommands::specs() {
        if let Some(k) = &spec.keybinding {
            per_accordo
                .entry(normalizza(k))
                .or_default()
                .push(spec.id.clone());
        }
    }
    let contesi: Vec<_> = per_accordo
        .iter()
        .filter(|(_, ids)| ids.len() > 1)
        .collect();
    assert!(
        contesi.is_empty(),
        "due comandi ufficiali vogliono lo stesso accordo: {contesi:?}"
    );
}

/// L'accordo in forma canonica, come lo normalizza la shell (`normalizza` in
/// `ui/commands.ts`): modificatori ordinati e minuscoli, o `Shift-Mod-g` e
/// `Mod-Shift-g` sarebbero due accordi per la tastiera e uno per le dita.
fn normalizza(binding: &str) -> String {
    let mut parti: Vec<&str> = binding.split('-').collect();
    let Some(tasto) = parti.pop() else {
        return binding.to_lowercase();
    };
    let mut mods: Vec<String> = parti.iter().map(|p| p.to_lowercase()).collect();
    mods.sort();
    mods.push(tasto.to_lowercase());
    mods.join("-")
}
