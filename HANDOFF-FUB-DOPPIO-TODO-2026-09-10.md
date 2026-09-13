# HANDOFF — certificare i documenti G3 e avviare lo slice 1 di #8

Questo è l'handoff operativo corrente al 13 settembre 2026 per `Fubeo/Fub`.
Conserva il nome storico del file, non autorizza il merge in `main` e non
anticipa alcun gate successivo a G3.

## Fonti e regole vincolanti

Prima di modificare il repository, leggere:

1. [`PIANO-AZIONE-FUB-AUDIT-2026-09-01.md`](PIANO-AZIONE-FUB-AUDIT-2026-09-01.md), che governa i 56 finding, C-01..C-10 e G0..G15;
2. [`docs/project/todo-superfici-di-editing-condivise.md`](docs/project/todo-superfici-di-editing-condivise.md), che governa le superfici condivise;
3. `AGENTS.md`, `CONTRIBUTING.md` e la documentazione canonica dell'area toccata.

Valgono sempre le regole più restrittive dell'audit: nessun callback provider o
codice esterno sotto `Custody<Workspace>`, nessuna scorciatoia tramite
`Host::workspace`, nessuna modifica ai WIT frozen, nessun CodeRabbit,
force-push, reset distruttivo o indebolimento dei test. Non introdurre `allow`
per Clippy, skip, `sleep` come sincronizzazione o mutex globale per serializzare
le suite. Non modificare `main` prima di G15/GO esplicito.

## Stato live verificato

Dopo il fetch live del 13 settembre 2026:

- [PR #32](https://github.com/Fubeo/Fub/pull/32): **OPEN, DRAFT**, base
  `fix/audit-integration`, head `fix/lifecycle-mount-detached`;
- head remoto esatto della PR #32:
  `9c5a4db2382d45ee709ada4668a840465d871c64`;
- `ARCH-001` e G3 sono **`CLOSED` sul tree `9c5a4db…`**;
- la [run CI PR 34746750247](https://github.com/Fubeo/Fub/actions/runs/34746750247)
  è `completed/success`, 8 job su 8, sul medesimo SHA;
- la [run CI push 34746748272](https://github.com/Fubeo/Fub/actions/runs/34746748272)
  è `completed/success` sul medesimo SHA;
- #8, #10, G14 e G15/GO sono **OPEN**;
- la decisione è **NO-GO — NOT READY FOR PHASE 9 — NON MERGIARE IN `main`**.

Rifetcha questi riferimenti prima di qualunque modifica o pubblicazione. Gli SHA
sono uno snapshot per rilevare drift, non istruzioni di reset. Se l'head remoto
della PR non è più `9c5a4db…`, fermati, confronta la storia e registra il nuovo
SHA live prima di procedere.

## Candidato e storia dei fix

Il tree live certificato include già i sei commit successivi a `fbe9676a…`:

| Commit | Correzione |
|---|---|
| `d8e86e83` | rollback delle opening non pubblicate |
| `8a9a530f` | avvio atomico dei worker |
| `0e0441ef` | pubblicazione atomica della sessione |
| `78a89f92` | contenimento dei panic nella preparazione dei bundle |
| `440bd410` | rollback dei mount parziali |
| `9c5a4db` | isolamento dei fallimenti della scansione su nomi non UTF-8 |

Il comportamento G3 risultante comprende:

- restore staged: autorizzazione e snapshot sotto guardia, lettura, parser,
  mossa no-replace e rollback fuori custodia, commit riconvalidato;
- rename esplicita staged per documenti e asset, inclusi filesystem, parser,
  backlink/identity, feed, side-data e journal;
- watcher articolato in prepare/invoke/finalize, con routing delle rename
  tracciate e flush anche dopo un errore parziale se il lotto ha già mutato;
- rebuild di manutenzione con camminata, letture, parser e callback staccati;
- flush con token e `IndexCall`, che rifiuta la rientranza sincrona nello stesso
  provider e ripristina il frame anche dopo un panic;
- `BeforeWrite` invocato con capacità strette e protetto dal panic prima che il
  documento venga scritto;
- mount, rollback, teardown, disposer e chiamate dirette del registry inclusi
  nel call graph di produzione verificato.

La certificazione G3/ARCH riguarda l'intero tree live `9c5a4db…`, inclusi i sei
fix sopra elencati; non va attribuita agli SHA intermedi `f626dfca…`,
`fbe9676a…` o `c17467ed…`.

## Prove conservate

Sul tree live esatto `9c5a4db2382d45ee709ada4668a840465d871c64`:

- [run CI PR 34746750247](https://github.com/Fubeo/Fub/actions/runs/34746750247):
  **PASS**, 8 job su 8;
- [run CI push 34746748272](https://github.com/Fubeo/Fub/actions/runs/34746748272):
  **PASS**;
- entrambe le run sono associate allo stesso SHA certificato.

Questa evidenza chiude `ARCH-001` e G3 sul tree live. Non costituisce evidenza
di completamento per #8, #10, G14 o G15/GO e non autorizza il merge in `main`.
In particolare, la matrice G14 56/56 non è dichiarata completa.

## Azione successiva esatta

1. Rifetcha `fix/lifecycle-mount-detached` e `pull/32/head`; procedi soltanto se
   entrambi indicano ancora `9c5a4db…`.
2. Avvia dal tree `9c5a4db…` lo **slice inventory/installazione di #8**.
3. Porta semanticamente dalla PR #30 soltanto l'inventario installato e mantieni
   gli eseguibili fuori da `.fub/plugins`.
4. Non fare merge né cherry-pick dell'intera PR #30.
5. Mantieni #8 e #10 aperte: lo slice non completa composition root, mount,
   teardown, percorso UI né provider WASM residui.

## Rischi e dichiarazioni lasciate aperte

Il rollback di una rename può correre contro un processo esterno:
`VaultStorage` non offre rename condizionale né reservation. La verifica
dell'identità evita di sovrascrivere alla cieca un file sostituito, ma non rende
il filesystem una transazione globale. Questo rischio resta esplicito anche
dopo la chiusura G3.

Restano intenzionalmente pendenti:

- la chiusura di #8 e #10;
- G14, senza dichiarare completa la matrice 56/56;
- G15/GO e ogni merge in `main`;
- il passaggio della PR #32 fuori dallo stato **OPEN, DRAFT**.

La decisione resta **NO-GO — NOT READY FOR PHASE 9 — NON MERGIARE IN `main`**.
La chiusura di `ARCH-001` e G3 sul tree `9c5a4db…` non completa da sola
l'audit: #8 e gli altri gate restano nell'ordine governato dal piano.
