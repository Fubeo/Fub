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

/// Gli accordi suggeriti per i comandi della shell, id → accordo.
export const SHELL_KEYS = {
  "shell.vault.open": "Mod-Shift-o",
  "shell.palette": "Mod-Shift-p",
  "shell.panel.files": "Mod-Shift-e",
  "shell.panel.search": "Mod-Shift-f",
  "shell.graph": "Mod-Shift-g",
  "shell.mode.reading": "Mod-e",
  "shell.mode.live": "Mod-Shift-l",
  "shell.pane.split.right": "Mod-\\",
  "shell.pane.split.down": "Mod-Shift-\\",
  "shell.pane.close": "Mod-Shift-w",
  "shell.tab.close": "Mod-w",
  "shell.doc.search": "Mod-f",
  "shell.switcher": "Mod-o",
  "shell.history.clear": null,
  "shell.doc.conflict.mine": null,
  "shell.doc.conflict.theirs": null,
} as const satisfies Record<string, string | null>;

/// L'id di un comando della shell: uno di quelli in tabella, e nessun altro.
export type ShellCommandId = keyof typeof SHELL_KEYS;
