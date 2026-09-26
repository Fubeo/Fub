// FILE GENERATO — non modificare a mano.
//
// Gli id che la shell riconosce senza possederli, emessi da
// `fub_host::shell` (crates/fub-host/tests/shell_ids_mirror.rs). Di là sono
// scritti con le costanti dei proprietari: la prosa su ciascuna scelta sta
// accanto alle tabelle, in `crates/fub-host/src/shell.rs`.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-host --test shell_ids_mirror

/// Le chiavi che il form generico delle impostazioni non disegna: hanno un
/// gesto loro altrove.
export const SETTINGS_WITH_THEIR_OWN_GESTURE: readonly string[] = [
  "chrome.schema",
  "plugins.disabled",
  "chrome.rail.order",
  "chrome.rail.hidden",
  "properties.types",
  "appearance.theme-id",
];

/// Il job il cui esito, quando riesce, può portare gli artefatti di un export.
export const ARTIFACT_JOB = "import.transfer";
