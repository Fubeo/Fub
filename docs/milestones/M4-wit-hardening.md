# M4 — Hardening del contratto + WIT

Torna a [../PIANO.md](../PIANO.md) · segue [M3](M3-editor-fidelity.md) · precede
[M5](M5-wasm-runtime.md).

## Obiettivo

**Congelare** la superficie dei trait di `fubmd-abi` e certificarla esprimibile in
WIT, così che il runtime WASM di [M5](M5-wasm-runtime.md) sia un lavoro *meccanico*
e non una rincorsa a firme non serializzabili. Provare l'intero confine con un
**primo plugin nativo** che usa `Plugin`/`HostApi`.

## Contesto: il `wit/` è già vivo da M2

Decisione presa: `wit/fubmd/*.wit` **non** nasce a M4 — è mantenuto vivo fin da M2,
con un test di conformità abi↔WIT che gira ad ogni commit. Così la "regola d'oro"
(vedi [../architecture/traits.md](../architecture/traits.md)) è verificata in
continuazione, non asserita. M4 è il punto in cui quel WIT viene **congelato** e
promosso a contratto stabile.

Stato repo: la cartella `wit/fubmd/` esiste già (vuota); `plugins/README.md` prevede
componenti `wasm32-wasip2` compilati con `cargo component`.

## Design

### Freeze della superficie dei trait

- Revisione finale dei 7 trait e di tutti i tipi che ne attraversano le firme
  (tabella di esprimibilità in [../architecture/traits.md](../architecture/traits.md)).
- Da qui: **cambi additivi versionati**; le modifiche breaking richiedono un bump di
  versione del contratto. Documentare la policy di compatibilità.
- Consolidare le estensioni introdotte in corso d'opera: `PluginPermissions.vault_scope`
  (vedi [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md)) e i
  nodi input di `UiNode` aggiunti a [M3](M3-editor-fidelity.md).

### `wit/fubmd/*.wit` che rispecchia `fubmd-abi`

- File WIT organizzati per area: `model`, `format`, `ui`, `index`, `events`,
  `command`, `plugin`, `host-api`.
- Mapping secondo la tabella in [traits.md](../architecture/traits.md): record,
  variant, enum, `list<..>`, `result<_, error>`; i valori JSON liberi (`attrs`,
  `args`, storage) come `type json = string`.
- Il component world del plugin (import: `host-api`; export: i provider
  implementati) è definito qui.

### Test di conformità abi↔WIT

- Un test che genera (o confronta) i tipi WIT a partire dai tipi Rust e fallisce se
  divergono: nomi, forma dei record/variant, cardinalità. Approcci possibili:
  `wit-bindgen` sui tipi + confronto strutturale, oppure round-trip di valori
  campione serde↔WIT-values. La scelta esatta è parte del lavoro M4; il requisito è
  che **il CI rompa** se `fubmd-abi` e `wit/` divergono.

### Primo plugin nativo (`Plugin`/`HostApi`)

- Un plugin **nativo** (non WASM) che implementa `Plugin` + almeno un provider
  (candidato: un `CommandProvider` utile, es. "inserisci data", o un `ViewProvider`
  semplice), attivato tramite il percorso di
  [../architecture/plugin-boundary.md](../architecture/plugin-boundary.md).
- Esercita: manifest, permessi (booleani + eventuale `vault_scope`), `activate`/
  `deactivate`, registrazione presso il registry, uso di `HostApi`.
- Valore: mette alla prova il confine **prima** di aggiungere WASM. Se `HostApi` è
  scomoda, si corregge qui (ultimo momento prima del freeze duro per M5).

## Trait/API coinvolti

- `Plugin`, `HostApi` (prima impl reale end-to-end).
- Tutti i trait, in sola lettura, per il freeze e il WIT.
- Registry del kernel: caricamento/attivazione plugin nativi.

## Decisioni (con il perché)

| Decisione | Perché |
|---|---|
| WIT **vivo da M2**, freeze a M4 | La regola d'oro diventa verificabile ad ogni commit, non un atto di fede a fine corsa. |
| Primo plugin **nativo** prima del WASM | Separa "il confine è giusto?" da "il runtime WASM funziona?"; M5 resta meccanico. |
| JSON libero come `string` in WIT | Preserva l'escape hatch (`attrs`/`args`/storage) senza esplodere il contratto. |
| Cambi additivi versionati post-freeze | Stabilità per i plugin di terzi senza bloccare l'evoluzione. |

## Criteri di accettazione

- `wit/fubmd/*.wit` copre l'intera superficie dei trait; il test di conformità
  abi↔WIT è verde e **rompe** su una divergenza introdotta ad arte.
- Il primo plugin nativo si attiva, registra i suoi provider, funziona end-to-end e
  rispetta i permessi (un accesso fuori `vault_scope` è negato con
  `PermissionDenied`).
- La superficie dei trait è dichiarata **congelata**; policy di versioning documentata.

## Piano di test

- **Conformità:** test abi↔WIT (fallimento indotto verificato).
- **Plugin nativo:** unit sul provider; e2e su attivazione/uso/disattivazione;
  test negativo sui permessi.
- **Regressione:** l'intera suite M1–M3 resta verde.
- `cargo test --workspace` + `cargo clippy` su tutti gli OS
  ([../appendix/platforms-ci.md](../appendix/platforms-ci.md)).

## Rischi / mitigazioni

- **Scoperta tardiva di una firma non-WIT** → mitigata a monte dal `wit/` vivo di M2;
  a M4 dovrebbero restare solo rifiniture.
- **Freeze prematuro** → il plugin nativo è l'ultima prova d'uso reale prima di
  chiudere; eventuali correzioni entrano prima del freeze.
- **Mapping del JSON libero** → confermare che `string`/`json` regga i casi reali di
  `attrs` (callout M3) e `args` (comandi).
