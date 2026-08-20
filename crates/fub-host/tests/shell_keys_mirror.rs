//! **Gli accordi della shell, emessi verso la shell** (§16.3).
//!
//! La tabella dei comandi di shell sta in [`fub_host::shell::SHELL_COMMANDS`], e
//! di là arriva generata: `frontend/src/ui/shell-keys.generated.ts`. Il giro è
//! quello degli altri mirror di questo repo — genera, confronta il committato,
//! `UPDATE_MIRROR=1` per rigenerare — e la ragione per cui è un derivato e non
//! due elenchi è quella della
//! [0056](../../../docs/decisions/0056-un-elenco-che-e-la-sorgente.md): quando la
//! produzione può **leggere** l'elenco, l'elenco smette di essere una copia da
//! confrontare e diventa la sorgente da cui la cosa esiste.
//!
//! Prima della [0116](../../../docs/decisions/0116-lo-scope-di-una-chiave-segue-la-vita-di-chi-la-dichiara.md)
//! la tabella stava in TypeScript, e il lato Rust non sapeva che esistesse: è il
//! quarto dei cinque ostacoli che la
//! [0090](../../../docs/decisions/0090-una-sequenza-e-una-modalita-che-scade.md)
//! aveva misurato — «il presidio non lo vedrebbe» — e si chiude spostando la
//! sorgente, non aggiungendo un secondo confronto.
//!
//! # La zona cieca, misurata costruendo il caso
//!
//! Il generato dice quali accordi i comandi di shell **dichiarano**, non quali
//! la shell **onora**: un comando registrato con `registerShellCommand` che non
//! stia in tabella non compila di là (`ShellCommandId` è una chiave del
//! generato), ma un id in tabella che nessun pannello registra resta verde da
//! tutte e due le parti — è una riga di impostazioni per un comando che non
//! c'è. Chi lo prende è la palette, che quel comando non lo mostra.

use std::path::PathBuf;

use fub_abi::rules::keys::{canonical, obscures};
use fub_host::shell::SHELL_COMMANDS;

const HEADER: &str = "\
// FILE GENERATO — non modificare a mano.
//
// Gli accordi dichiarati dei comandi della shell, emessi da
// `fub_host::shell::SHELL_COMMANDS` (crates/fub-host/tests/shell_keys_mirror.rs,
// decisione 0116). `null` è un comando che una scorciatoia non la vuole: sta in
// tabella lo stesso, perché l'elenco è quello dei comandi e non quello delle
// scorciatoie.
//
// La tabella sta di là perché un conflitto di scorciatoie riguarda i **due**
// registri insieme, e il registro del kernel è in casa di Rust. La prosa su
// ciascuna scelta sta accanto alla tabella, in `crates/fub-host/src/shell.rs`:
// qui non c'è niente che qualcuno abbia deciso.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-host --test shell_keys_mirror
";

fn path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../frontend/src/ui/shell-keys.generated.ts")
}

fn render() -> String {
    let mut out = String::from(HEADER);
    out.push_str(
        "\n/// Suggested bindings for shell commands, id -> binding.\n\
         export const SHELL_KEYS = {\n",
    );
    for (id, chord) in SHELL_COMMANDS {
        let binding = match chord {
            Some(c) => format!("{c:?}"),
            None => "null".into(),
        };
        out.push_str(&format!("  {id:?}: {binding},\n"));
    }
    out.push_str("} as const satisfies Record<string, string | null>;\n\n");
    out.push_str(
        "/// Id of a shell command: one of those in the table, and no other.\n\
         export type ShellCommandId = keyof typeof SHELL_KEYS;\n",
    );
    out
}

#[test]
fn emitted_bindings_match_table() {
    let emitted = render();
    let path = path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &emitted).expect("writes generated bindings");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "generated bindings missing ({}): {and}. Regenerate with \
             `UPDATE_MIRROR=1 cargo test -p fub-host --test shell_keys_mirror`.",
            path.display()
        )
    });

    assert_eq!(
        emitted, committed,
        "`frontend/src/ui/shell-keys.generated.ts` is stale: the shell \
         command table changed without regenerating it.\nRegenerate with \
         `UPDATE_MIRROR=1 cargo test -p fub-host --test shell_keys_mirror`."
    );
}

/// **I due registri, guardati insieme di qua.**
///
/// La stessa domanda del gemello vitest (`frontend/src/ui/keybindings.test.ts`),
/// che finora era l'unico posto in cui i due registri si potevano incontrare —
/// il kernel da una fixture, la shell da una tabella TypeScript. Da quando la
/// tabella sta in Rust si può porre anche qui, e vale la pena porla in tutti e
/// due: di là il rosso arriva a chi tocca la shell, di qua a chi tocca il
/// registro dei comandi, e sono due persone diverse.
#[test]
fn no_binding_declared_by_both_registries() {
    let mut for_binding: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    let mut from_kernel = 0usize;
    let mut from_shell = 0usize;
    let mut untypeable: Vec<(String, String)> = Vec::new();
    for spec in fub_features::commands::CoreCommands::specs() {
        if let Some(k) = &spec.keybinding {
            from_kernel += 1;
            match canonical(k) {
                Some(key) => for_binding.entry(key).or_default().push(spec.id.clone()),
                None => untypeable.push((spec.id.clone(), k.clone())),
            }
        }
    }
    for (id, chord) in SHELL_COMMANDS {
        if chord.is_some() {
            from_shell += 1;
        }
        if let Some(k) = chord {
            match canonical(k) {
                Some(key) => for_binding
                    .entry(key)
                    .or_default()
                    .push((*id).to_string()),
                None => untypeable.push(((*id).to_string(), (*k).to_string())),
            }
        }
    }
    let contested: Vec<_> = for_binding
        .iter()
        .filter(|(_, ids)| ids.len() > 1)
        .collect();
    assert!(
        contested.is_empty(),
        "a binding is declared by two commands this app dispatches: {contested:?}"
    );

    // Un accordo che questa app non sa premere: la shell lo ignora, e finché la
    // forma canonica era una copia che normalizzava qualunque stringa nessuno
    // dei due registri poteva accorgersene (difetto 0148).
    assert!(
        untypeable.is_empty(),
        "a command this app dispatches declares a binding the shell cannot \
         press, and will ignore without telling anyone: {untypeable:?}"
    );

    // Il test del test: due elenchi vuoti non litigherebbero mai, e un elenco
    // vuoto **su due** basterebbe a rendere la domanda una domanda a metà — che
    // è precisamente il modo in cui `Mod-Shift-f` è passato (0081).
    assert!(
        from_kernel > 0 && from_shell > 5,
        "{from_kernel} + {from_shell}"
    );
}

/// Nessun id sta nei due registri. Non sarebbe un conflitto di tasti ma
/// qualcosa di peggio: la palette mostrerebbe due voci uguali e la tastiera ne
/// eseguirebbe una sola, scelta dall'ordine di `allCommands`.
#[test]
fn no_id_in_both_registries() {
    let kernel_ids: std::collections::BTreeSet<String> =
        fub_features::commands::CoreCommands::specs()
            .into_iter()
            .map(|s| s.id)
            .collect();
    let duplicates: Vec<&str> = SHELL_COMMANDS
        .iter()
        .map(|(id, _)| *id)
        .filter(|id| kernel_ids.contains(*id))
        .collect();
    assert!(duplicates.is_empty(), "{duplicates:?}");
}

/// **Nessun accordo di questa app è irraggiungibile perché un altro lo
/// precede.**
///
/// La domanda del banco qui sopra guarda i due registri insieme e vede gli
/// accordi *uguali*; questa vede quelli che sono l'**inizio** di un altro, che
/// con le sequenze è lo stesso danno per chi preme e nessuno dei due registri
/// può vederlo da solo — la shell lo sapeva per i propri (`prefissiOscurati`) e
/// il kernel non ne aveva copia (difetto 0148).
#[test]
fn no_binding_shadows_another() {
    let mut declared: Vec<(String, String)> = fub_features::commands::CoreCommands::specs()
        .into_iter()
        .filter_map(|s| s.keybinding.map(|k| (s.id, k)))
        .collect();
    for (id, chord) in SHELL_COMMANDS {
        if let Some(k) = chord {
            declared.push(((*id).to_string(), (*k).to_string()));
        }
    }
    let shadowed: Vec<String> = declared
        .iter()
        .flat_map(|(id_short, short)| {
            declared
                .iter()
                .filter(move |(_, long)| obscures(short, long))
                .map(move |(id_long, long)| {
                    format!("\"{short}\" ({id_short}) shadows \"{long}\" ({id_long})")
                })
        })
        .collect();
    assert!(
        shadowed.is_empty(),
        "a command this app dispatches cannot be pressed because another \
         binding is its prefix and fires first: {shadowed:?}"
    );
}
