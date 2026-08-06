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
        "\n/// Gli accordi suggeriti per i comandi della shell, id → accordo.\n\
         export const SHELL_KEYS = {\n",
    );
    for (id, chord) in SHELL_COMMANDS {
        let accordo = match chord {
            Some(c) => format!("{c:?}"),
            None => "null".into(),
        };
        out.push_str(&format!("  {id:?}: {accordo},\n"));
    }
    out.push_str("} as const satisfies Record<string, string | null>;\n\n");
    out.push_str(
        "/// L'id di un comando della shell: uno di quelli in tabella, e nessun altro.\n\
         export type ShellCommandId = keyof typeof SHELL_KEYS;\n",
    );
    out
}

#[test]
fn gli_accordi_emessi_sono_quelli_della_tabella() {
    let emesso = render();
    let path = path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &emesso).expect("scrive gli accordi generati");
        return;
    }

    let committato = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "accordi generati mancanti ({}): {e}. Rigenerali con \
             `UPDATE_MIRROR=1 cargo test -p fub-host --test shell_keys_mirror`.",
            path.display()
        )
    });

    assert_eq!(
        emesso, committato,
        "`frontend/src/ui/shell-keys.generated.ts` è stantio: la tabella dei \
         comandi della shell è cambiata senza rigenerarlo.\nRigenera con \
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
fn nessun_accordo_e_dichiarato_dai_due_registri() {
    let mut per_accordo: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    let mut dal_kernel = 0usize;
    let mut dalla_shell = 0usize;
    for spec in fub_features::commands::CoreCommands::specs() {
        if let Some(k) = &spec.keybinding {
            dal_kernel += 1;
            per_accordo
                .entry(normalizza(k))
                .or_default()
                .push(spec.id.clone());
        }
    }
    for (id, chord) in SHELL_COMMANDS {
        if chord.is_some() {
            dalla_shell += 1;
        }
        if let Some(k) = chord {
            per_accordo
                .entry(normalizza(k))
                .or_default()
                .push((*id).to_string());
        }
    }
    let contesi: Vec<_> = per_accordo
        .iter()
        .filter(|(_, ids)| ids.len() > 1)
        .collect();
    assert!(
        contesi.is_empty(),
        "un accordo è dichiarato da due comandi che questa app spedisce: {contesi:?}"
    );

    // Il test del test: due elenchi vuoti non litigherebbero mai, e un elenco
    // vuoto **su due** basterebbe a rendere la domanda una domanda a metà — che
    // è precisamente il modo in cui `Mod-Shift-f` è passato (0081).
    assert!(
        dal_kernel > 0 && dalla_shell > 5,
        "{dal_kernel} + {dalla_shell}"
    );
}

/// Nessun id sta nei due registri. Non sarebbe un conflitto di tasti ma
/// qualcosa di peggio: la palette mostrerebbe due voci uguali e la tastiera ne
/// eseguirebbe una sola, scelta dall'ordine di `allCommands`.
#[test]
fn nessun_id_sta_nei_due_registri() {
    let del_kernel: std::collections::BTreeSet<String> =
        fub_features::commands::CoreCommands::specs()
            .into_iter()
            .map(|s| s.id)
            .collect();
    let doppi: Vec<&str> = SHELL_COMMANDS
        .iter()
        .map(|(id, _)| *id)
        .filter(|id| del_kernel.contains(*id))
        .collect();
    assert!(doppi.is_empty(), "{doppi:?}");
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
