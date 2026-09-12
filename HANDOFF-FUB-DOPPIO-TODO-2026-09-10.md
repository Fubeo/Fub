# HANDOFF — certificare i documenti G3 e avviare lo slice 1 di #8

Questo è l'handoff operativo corrente al 12 settembre 2026 per `Fubeo/Fub`.
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
force-push, reset distruttivo o indebolimento dei test. Non modificare `main`
prima di G15/GO esplicito.

## Stato live verificato

Dopo il fetch del 12 settembre 2026:

- [PR #32](https://github.com/Fubeo/Fub/pull/32): **OPEN, DRAFT**, base
  `fix/audit-integration`, head `fix/lifecycle-mount-detached`;
- head remoto esatto della PR #32:
  `4b957b25e23d89814344463e0fcfc77438a72501`;
- il worktree `work/g3-integration` parte da
  `c8980cecb99b56979ec054c9c117c87efa5f5bc5`, un commit avanti rispetto
  all'head remoto (`0` remoto, `1` locale);
- `origin/fix/audit-integration` è
  `7efc4375a7167ea3df5070673c6c2163a758a0f2`; il candidato locale è `89`
  commit avanti e `0` indietro rispetto a quella base;
- `ARCH-001` e G3 restano **`CLOSED`** con provenienza sul candidato certificato
  `f626dfca8a3c5271f64ec14368e10d09af8f937d`;
- #8 e #10 sono **OPEN**;
- G15/GO resta aperto e `main` non è autorizzato al merge.

Rifetcha questi riferimenti prima di qualunque pubblicazione. Gli SHA sono uno
snapshot per rilevare drift, non istruzioni di reset. Se l'head remoto della PR
non è più `4b957b25…`, confronta la storia e integra soltanto se il nuovo head è
compatibile.

## Candidato e storia dei fix

La sequenza rilevante conserva sia i fix sia gli aggiornamenti documentali:

| Commit | Stato | Origine e correzione |
|---|---|---|
| `7e3719f2` | remoto | CI 34706406133: riduce la variante documentale segnalata da Clippy |
| `27808660` | remoto | rimuove l'import inutilizzato emerso dal Clippy locale con Rust `1.89` |
| `a0b77232` | remoto | canonicalizza nel test watcher la radice confrontata su macOS/Windows |
| `356c2920` | remoto | aggiorna i documenti e avvia le due run CI poi risultate racy |
| `ca0896ca` | remoto | sincronizza le osservazioni concorrenti nei test stale/flush |
| `e8428be9` | remoto | mantiene il turno nella verifica finale del flush |
| `f626dfca` | remoto certificato | registra la seconda CI e costituisce lo SHA di chiusura G3 |
| `4b957b25` | remoto corrente | aggiorna i documenti; CI PR verde, CI push cancellata durante un test host bloccato |
| `c8980cec` | locale | fix test-only: rilascia esplicitamente il turno della probe prima di `host.close()` |

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

`c8980cec` modifica soltanto la regressione host: non cambia il comportamento
G3/ARCH di produzione e non sposta la provenienza della chiusura da
`f626dfca…`.

## Prove conservate

Sul candidato locale esatto
`c8980cecb99b56979ec054c9c117c87efa5f5bc5`:

- `cargo +1.89 fmt --all -- --check`: **PASS**;
- Clippy workspace, tutti i target, `-D warnings`, Rust `1.89`: **PASS**;
- `fub-host`: 334 test verdi in 42 eseguibili;
- `git diff --check` e stato finale della validazione: **PASS/pulito**.

Sul commit antenato `1b0f13f125450b98170cf4ae17acc0b163506007`:

- call graph finale dei percorsi di produzione che attraversano
  `Custody<Workspace>`: **PASS**;
- kernel: 800 test verdi in 62 eseguibili, 1 ignorato;
- features: 350 test verdi in 36 eseguibili, 2 ignorati.

Kernel e feature non sono stati rieseguiti per `c8980cec`: questi risultati
restano storici e non vanno attribuiti al candidato locale.

Le due run sul precedente head
`356c2920d9bbefeecd30317e6ec2a9cabb8cbb46` restano nella storia:

- la [run PR 34707687690](https://github.com/Fubeo/Fub/actions/runs/34707687690)
  fallì soltanto nel job macOS `103590610888`, dove
  `an_action_from_a_replaced_view_provider_is_rejected_as_stale` scadde in
  attesa del vecchio provider; gli altri sette job furono verdi;
- la [run push 34707684943](https://github.com/Fubeo/Fub/actions/runs/34707684943)
  fallì soltanto nel job Ubuntu `103590603150`, dove
  `opening_runner_flush_releases_custody_and_allows_host_reentry` perse
  l'asserzione finale `try_write`; gli altri sette job furono verdi.

Le cause radice erano due osservazioni non bloccanti racy, non una violazione
del confine di custodia. `ca0896ca` sincronizza le asserzioni e usa nel provider
stale l'accesso bloccante governato dal watchdog; `e8428be9` conserva il turno
di scrittura nella verifica finale del flush. I fix sono test-only e non
ampliano alcun timeout.

Il candidato certificato
`f626dfca8a3c5271f64ec14368e10d09af8f937d` conserva la CI completa PR e push
8/8 e le due run NPM verdi già registrate. Questa evidenza chiude `ARCH-001` e
G3 sul candidato di codice.

Sul successivo head remoto
`4b957b25e23d89814344463e0fcfc77438a72501`:

- la [run CI PR 34711147682](https://github.com/Fubeo/Fub/actions/runs/34711147682)
  è `completed/success`, 8 job su 8;
- la [run NPM PR 34711147695](https://github.com/Fubeo/Fub/actions/runs/34711147695)
  e la [run NPM push 34711144423](https://github.com/Fubeo/Fub/actions/runs/34711144423)
  sono `completed/success`;
- la [run CI push 34711144437](https://github.com/Fubeo/Fub/actions/runs/34711144437)
  è `completed/cancelled`: sette job sono verdi, mentre il job Ubuntu
  `103600048382` è stato cancellato dopo circa 40 minuti.

La run push `34711144437` non è verde. Nel job Ubuntu il test
`opening_runner_flush_rejects_same_provider_reentry_and_releases_its_guard`
rimaneva bloccato: la probe di test conservava il turno del writer durante
`host.close()`. `c8980cec` integra la correzione test-only e rilascia
esplicitamente quel turno prima della chiusura.

## Azione successiva esatta

1. Integra questo commit solo documentale sopra `c8980cec…` senza reset o
   force.
2. Rifetcha la PR #32 e verifica che l'head remoto sia ancora `4b957b25…` e che
   la storia locale sia un fast-forward compatibile.
3. Pubblica l'head risultante su `fix/lifecycle-mount-detached` con push
   ordinario, mai force-push.
4. Attendi una CI completa sul nuovo SHA. Il candidato resta **`CI_PENDING`**:
   la PR #32 deve restare draft e la pubblicazione finale resta bloccata finché
   quella CI non è interamente verde. Questo presidio non riapre il gate tecnico
   G3.
5. Come prossimo lavoro funzionale, avvia lo **slice 1 di #8**: porta
   semanticamente dalla PR #30 il solo inventario installato, adattalo alla
   linea G3 corrente e mantieni gli eseguibili fuori da `.fub/plugins`.
   **Non fare merge né cherry-pick dell'intera PR #30.**
6. Mantieni #8 e #10 aperte: lo slice 1 non completa installazione, composition
   root, mount, teardown, percorso UI né provider WASM residui.

## Rischi e dichiarazioni lasciate aperte

Il rollback di una rename può correre contro un processo esterno:
`VaultStorage` non offre rename condizionale né reservation. La verifica
dell'identità evita di sovrascrivere alla cieca un file sostituito, ma non rende
il filesystem una transazione globale. Questo rischio resta esplicito anche
dopo la chiusura G3.

Restano intenzionalmente pendenti:

- push ordinario del nuovo SHA che include `c8980cec` e questo aggiornamento;
- CI completa interamente verde sul nuovo SHA, ora **`CI_PENDING`**;
- passaggio della PR #32 da draft a ready e pubblicazione dello stato finale;
- chiusura di #8, #10 o qualunque altra issue;
- G14 con la matrice completa 56/56;
- G15/GO e ogni merge in `main`.

La decisione resta **NO-GO — NOT READY FOR PHASE 9**. La chiusura di
`ARCH-001` e G3 non completa da sola l'audit: #8 e gli altri gate restano
nell'ordine governato dal piano.
