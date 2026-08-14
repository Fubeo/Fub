# 0159 — L'escape hatch JSON resta: `type json = string`

**Stato**: accolta **Data**: 2026-08-14 **Chiude**: la voce B «Escape hatch
`type json = string`» di [todo.md](../todo.md) **Commit**: *(questo commit)*

---

## La domanda

La voce chiedeva di confermare al freeze, uso per uso, che l'opacità dei valori
JSON liberi è accettabile — o di promuoverli a record WIT tipati dove non lo è.
Il costo di tenerla: nessun controllo di forma al confine; il costo di
toglierla: il contratto esplode a ogni formato nuovo.

## La premessa, rimisurata

Rimisurata a `crates/fub-abi/wit/fub/abi.wit:36-38` e ai tipi che la
attraversano.

- **La dichiarazione è una riga sola.** `interface json { type json = string; }`
  in `abi.wit:36-38`, col doc che nomina già i quattro usi: *«frontmatter,
  `attrs` dell'escape hatch, argomenti dei comandi, storage dei plugin»*.
- **Gli usi sono sette, e sono tutti `serde_json::Value` in Rust.** Il
  frontmatter e gli `attrs` (il callout M3) viaggiano come JSON libero; gli
  **args dei comandi** sono `serde_json::Value` in `CommandSpec::validate_args`
  (`crates/fub-abi/src/command.rs:193`); **`run_command`** prende
  `args: serde_json::Value` (`traits.rs:1306`); il **payload dei job** è
  `JobSpec { job, payload: serde_json::Value }` (`traits.rs:48-51`); il
  **payload di `ui-action`** è `serde_json::Value` (`ui.rs:800-803`); il
  **payload di `Event::Custom`** è `serde_json::Value` (`event.rs:1085`).
- **La convalida sta già a monte, nel contratto.** `CommandSpec::validate_args`
  applica le tre regole dei `ParamSpec` (`command.rs:193-195`), e
  `SettingKind::rejects` fa lo stesso per i valori delle impostazioni
  (`settings.rs:144`). Il confine non è il posto dove si controlla la forma: lo
  è chi dichiara la forma.
- **Chi consuma parsa da sé.** Il payload di un job lo legge il plugin che lo
  esegue; il payload di un'azione lo legge il provider che l'ha scritto; il
  payload di `Event::Custom` lo legge chi si è abbonato al topic. Nessuno di
  questi ha bisogno che il contratto conosca la forma: la conosce chi la
  produce.
- **0053: il WIT è una proiezione.** La
  [0053](0053-il-contratto-ha-una-sorgente.md) ha deciso che la sorgente del
  contratto è Rust e che WIT e mirror TypeScript sono due proiezioni su due
  confini che non hanno la stessa forma. Tipizzare il JSON nel WIT vorrebbe dire
  far decidere a una proiezione la forma di dati che la sorgente dichiara
  opachi.

## La decisione

**`type json = string` resta, uso per uso.** I sette usi sono tutti dello
stesso genere: dati la cui forma la decide chi li produce e li consuma, non il
confine che li trasporta. Tipizzarli vorrebbe dire un record WIT per ogni
formato — frontmatter, attrs, args di ogni comando, payload di ogni job, payload
di ogni azione, payload di ogni evento custom — e ognuno di quei record sarebbe
una **major** al primo formato nuovo, cioè esattamente il costo che la voce
misurava. La convalida sta a monte (`validate_args`, `rejects`) e la lettura
sta a valle (chi consuma parsa da sé): il confine non è il posto di nessuna
delle due.

## Le forme scartate

- **Record WIT tipati per ogni formato** — scartata: il contratto esplode a
  ogni formato nuovo, e ogni formato nuovo diventa una major. È il costo che la
  voce stessa nominava, ed è il motivo per cui l'escape hatch esiste.
- **Un `json` tipizzato per famiglia** (un record per i comandi, uno per i
  job…) — scartata: sposta il problema di un piano, e le famiglie sono
  eterogenee quanto i formati — gli args di un comando non hanno la forma degli
  args di un altro.

## Cosa resta scoperto

- **Nessun controllo di forma al confine**: un payload malformato si scopre da
  chi lo parsa, non prima. È il prezzo dichiarato della voce, e resta com'è.
- **Il giorno in cui un formato smette di essere eterogeneo** — un payload che
  tutti i produttori scrivono nella stessa forma — quel payload può essere
  promosso a tipo, additivamente, senza toccare gli altri. La porta resta
  aperta, come l'escape hatch vuole.
