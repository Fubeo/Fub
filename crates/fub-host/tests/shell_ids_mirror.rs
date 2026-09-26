//! **Gli id che la shell riconosce senza possederli, emessi verso la shell.**
//!
//! Le chiavi con un gesto loro e il job degli artefatti stanno in
//! [`fub_host::shell`], scritti con le costanti di chi li possiede, e di là
//! arrivano generati: `apps/client/src/ui/shell-ids.generated.ts`. Il giro è
//! quello di `shell_keys_mirror` — genera, confronta il committato,
//! `UPDATE_MIRROR=1` per rigenerare — e la ragione è la stessa: un id scritto
//! per letterale nella shell sopravvive al rename del proprietario e smette in
//! silenzio di valere.

use std::path::PathBuf;

use fub_host::shell::{ARTIFACT_JOB, SETTINGS_WITH_THEIR_OWN_GESTURE};

const HEADER: &str = "\
// FILE GENERATO — non modificare a mano.
//
// Gli id che la shell riconosce senza possederli, emessi da
// `fub_host::shell` (crates/fub-host/tests/shell_ids_mirror.rs). Di là sono
// scritti con le costanti dei proprietari: la prosa su ciascuna scelta sta
// accanto alle tabelle, in `crates/fub-host/src/shell.rs`.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-host --test shell_ids_mirror
";

fn path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/client/src/ui/shell-ids.generated.ts")
}

fn render() -> String {
    let mut out = String::from(HEADER);
    out.push_str(
        "\n/// Le chiavi che il form generico delle impostazioni non disegna: hanno un\n\
         /// gesto loro altrove.\n\
         export const SETTINGS_WITH_THEIR_OWN_GESTURE: readonly string[] = [\n",
    );
    for key in SETTINGS_WITH_THEIR_OWN_GESTURE {
        out.push_str(&format!("  {key:?},\n"));
    }
    out.push_str("];\n\n");
    out.push_str(&format!(
        "/// Il job il cui esito, quando riesce, può portare gli artefatti di un export.\n\
         export const ARTIFACT_JOB = {ARTIFACT_JOB:?};\n"
    ));
    out
}

#[test]
fn emitted_ids_match_the_tables() {
    let emitted = render();
    let path = path();

    if std::env::var_os("UPDATE_MIRROR").is_some() {
        std::fs::write(&path, &emitted).expect("writes generated ids");
        return;
    }

    let committed = std::fs::read_to_string(&path).unwrap_or_else(|and| {
        panic!(
            "generated ids missing ({}): {and}. Regenerate with \
             `UPDATE_MIRROR=1 cargo test -p fub-host --test shell_ids_mirror`.",
            path.display()
        )
    });

    assert_eq!(
        emitted, committed,
        "`apps/client/src/ui/shell-ids.generated.ts` is stale: a table in \
         `fub_host::shell` changed without regenerating it.\nRegenerate with \
         `UPDATE_MIRROR=1 cargo test -p fub-host --test shell_ids_mirror`."
    );
}

/// Ogni chiave della tabella è una chiave **dichiarata** da qualcuno: una riga
/// rimasta dopo che il proprietario ha smesso di dichiararla nasconderebbe
/// un'impostazione che non c'è, e il generato resterebbe verde.
#[test]
fn every_key_with_its_own_gesture_is_declared() {
    let declared: Vec<String> = fub_host::settings::core_settings()
        .into_iter()
        .chain(fub_kernel::families::Family::all_settings())
        .map(|spec| spec.key)
        .collect();
    for key in SETTINGS_WITH_THEIR_OWN_GESTURE {
        assert!(
            declared.iter().any(|d| d == key),
            "`{key}` is in SETTINGS_WITH_THEIR_OWN_GESTURE but nobody declares it"
        );
    }
}
