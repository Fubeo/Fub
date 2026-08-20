// FILE GENERATO — non modificare a mano.
//
// La dichiarazione della sintassi, emessa da un montaggio VERO
// (crates/fub-host/tests/sintassi_dichiarata.rs, decisione 0115). I nomi sono
// il vocabolario di `fub_abi::options::syntax`; il trigger c'è per le sintassi
// che una `SyntaxRule` innesta dichiarandone la forma, e manca per quelle che
// il provider conosce come grammatica — che è il confine oltre il quale chi
// decora un buffer si arrangia.
//
// La forma JSON è quella di serde, cioè quella che attraverserà l'IPC il giorno
// in cui questa dichiarazione arriverà a runtime invece che alla compilazione.
//
// La prosa sta accanto a chi lo interpreta, in `sintassi.ts`: qui non c'è
// niente che qualcuno abbia deciso.
//
// Rigenera con: UPDATE_MIRROR=1 cargo test -p fub-host --test sintassi_dichiarata

export const MARKDOWN_SYNTAX = [
  { name: "fub:callouts", trigger: null },
  { name: "fub:definition-lists", trigger: null },
  { name: "fub:embeds", trigger: null },
  { name: "fub:footnotes", trigger: null },
  { name: "fub:frontmatter", trigger: null },
  { name: "fub:tags", trigger: null },
  { name: "fub:wikilinks", trigger: null },
  { name: "fub:diagrams", trigger: { fence: { info: ["mermaid", "plantuml", "graphviz", "dot", "d2"] } } },
  { name: "fub:math", trigger: { fence: { info: ["math", "latex", "tex"] } } },
  { name: "fub:highlight", trigger: { inline: { open: "==", close: "==" } } },
] as const;
