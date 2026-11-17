# Contratto dei componenti

> **Ambito:** le due porte IPC della pagina «Componenti» (`components_map`,
> `components_apply`), le loro forme, i rifiuti tipati, l'avviso del
> rimontaggio e lo scenario che serve l'host finto.
> **Fonti autorevoli:** `crates/fub-app/src/lib.rs` (`components_map_for`,
> `components_apply_for`), `crates/fub-host/src/componenti.rs`
> (`Host::components`, `Host::apply_components`),
> `apps/client/src/host/contract.ts` e
> `apps/client/src/__fixtures__/components-scenario.json`.

Il resto del confine IPC è nel [contratto IPC](ipc-contract.md).

La pagina «Componenti» ha due porte dedicate, in `allow-shell` e quindi solo
per la finestra principale. Non passa da `query_index` o `invoke_command`
perché lo stato dei componenti, come `plugins.disabled`, non è
`program_writable`: un componente non deve poter spegnere gli altri. Le due
porte applicano la stessa regola della CLI e di MCP (`Host::components`,
`Host::apply_components`); con l'app aperta CLI e MCP arrivano dal canale di
controllo (`Call::Components`, `Call::ApplyComponents`).

- `components_map(vault)` risponde `ComponentsMap`: i `gruppi`
  (`ComponentGroup`: `id` e `nome`, nell'ordine scrivere, leggere, pensare,
  disegnare, ufficio, foto, altro, supporto, e solo quelli che in questa build
  hanno righe), le righe (`ComponentRow`: id, `nome`, `descrizione`, `gruppo`
  — l'id di un gruppo, `altro` se la riga non ne dice uno —, `tipo`
  `mode`/`engine`/`service`/`data`, `ui` — le cartelle del client che carica,
  come `editors/media` —, `richiede` già risolto in id, `usa`, `acceso`,
  `perche`, `richiesto_da`, `bundle`), lo `stato` (scelti, in attesa), il
  `profilo` attivo (`null` = personalizzato), i `profili` con `etichetta`,
  `piu_avanti` e `arriva_con`, e i `mancanti` delle chiavi `components.*`.
  **I testi arrivano già risolti** nella lingua del vault (`locale.language`,
  con quella del sistema come ripiego), dal catalogo
  `fub_features::componenti::catalog` (`component.<x>.name`,
  `component.<x>.description`, `component.group.<g>.name`,
  `profile.<p>.name`). Sul filo non esce mai una chiave: un nome che il
  catalogo non ha è l'id della riga (del gruppo, del profilo), una
  descrizione che non ha è vuota.
- `components_apply(vault, azione, apply)` riceve un'azione
  (`{ azione: "accendi" | "spegni" | "rispondi" | "profilo", … }`; spegni ha
  `anche_questi` e `orfani` `chiedi`/`togli`/`tieni`). Con `apply` assente o
  falso è una prova: dice che cosa cambierebbe e non scrive. Risponde
  `ComponentsApplied`, con il tag `risposta`:
  - `{ risposta: "esito", … }`: l'`effetto` (`accesi_anche` è «Attivati
    anche…», `spenti_anche`, `orfani`, `mancanti`), le `scritture`, le
    `chiavi` che cambiano, lo `stato` dopo, `applicato` e gli `avvisi`;
  - `{ risposta: "rifiuto", rifiuto: … }`: il **rifiuto tipato**
    (`sconosciuto`, `nucleo`, `richiesto` con `da`, `profilo_sconosciuto`,
    `profilo_piu_avanti` con `arriva_con`). Non è un errore: la shell lo dice
    con le sue parole.

Gli errori restano per ciò che non è una scelta: a vault chiuso tutte e due le
porte rispondono `not_found`.

**L'avviso del rimontaggio.** Spegnere o riaccendere la lavagna rimonta il
vault (`Host::remount`): l'esito ha una scrittura su `fub.lavagna`, e dal
ponte degli eventi escono `vault_closed` e poi `vault_opened` dello stesso
`root`. Il secondo lo emette `remount` sul bus del vault riaperto, solo verso
gli abbonati e non verso gli handler dei plugin, perché quello della
scansione esce prima che il ponte nuovo si abboni. Vale per ogni strada:
`components_apply` e il canale di controllo. Una scelta che non rimonta lo
dice con `setting_changed` su `plugins.disabled` o sulle chiavi
`components.*`.

Nei test e nel banco l'host finto non ha un risolutore: serve le risposte
dell'host vero registrate in `apps/client/src/__fixtures__/components-scenario.json`
(vault temporaneo con il profilo «Studio»), che
`UPDATE_MIRROR=1 cargo test -p fub-app --test ts_mirror_app` rigenera, e
rifiuta lanciando una scelta che lo scenario non ha. Lo scenario passa per
ogni gesto della pagina da «Studio» e da «Solo note» (profili, rifiuti
`nucleo` e `richiesto`, `anche_questi`, il profilo che diventa
personalizzato, il PDF che accende la penna, la lavagna che rimonta, la penna
orfana e le due risposte); ogni mappa ci sta una volta sola (`mappe`), e
`partenze` nomina gli stati da cui il finto può partire (`componentsStart` in
`createFakeHost`, `?componenti=solo-note` nel banco; di serie «Studio»). Per
ogni scelta applicata lo scenario porta gli `eventi` che l'host vero ha
mandato dopo la risposta (`setting_changed`, `vault_closed`, `vault_opened`,
con la radice `/vault`): il finto li manda nello stesso ordine, in un giro del
ciclo degli eventi successivo alla risposta e con la radice del suo vault.
`componentsFromOutside` applica una scelta come farebbero CLI o MCP (stato ed
eventi, senza `componentsApply`), `componentsFail` fa rispondere a
`componentsApply` un `PluginError`.
