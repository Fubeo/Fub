# HANDOFF — pubblicare il candidato G3 e attendere la CI

Questo è l'handoff operativo corrente al 12 settembre 2026 per `Fubeo/Fub`.
Conserva il nome storico del file, non autorizza il merge in `main` e non
dichiara G3 concluso.

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

- `origin/main`: `cf50f60fd17e53d11e74ff2e7af96d572f69b10e`;
- `origin/fix/audit-integration`:
  `7efc4375a7167ea3df5070673c6c2163a758a0f2`;
- [PR #32](https://github.com/Fubeo/Fub/pull/32): **OPEN, DRAFT**, base
  `fix/audit-integration`, head `fix/lifecycle-mount-detached`;
- head remoto della PR #32:
  `356c2920d9bbefeecd30317e6ec2a9cabb8cbb46`;
- branch locale di consegna: `work/g3-integration`, HEAD
  `e8428be9729fd2489bbf00e445329d27ec74bb58`;
- intervallo locale non pubblicato:
  `356c2920d9bbefeecd30317e6ec2a9cabb8cbb46..e8428be9729fd2489bbf00e445329d27ec74bb58`;
- divergenza: **2 commit avanti, 0 indietro**; il delta è fast-forward.

Rifetcha questi riferimenti prima della pubblicazione. Gli SHA sono uno snapshot
per rilevare drift, non istruzioni di reset. Se l'head remoto della PR non è più
`356c2920…`, confronta la storia e integra soltanto se il nuovo head è
compatibile.

## Candidato e fix locali

L'head remoto contiene già i precedenti fix del candidato e il loro
aggiornamento documentale. La sequenza rilevante è:

| Commit | Stato | Origine e correzione |
|---|---|---|
| `7e3719f2` | remoto | CI 34706406133: riduce la variante documentale segnalata da Clippy |
| `27808660` | remoto | rimuove l'import inutilizzato emerso dal Clippy locale con Rust `1.89` |
| `a0b77232` | remoto | canonicalizza nel test watcher la radice confrontata su macOS/Windows |
| `356c2920` | remoto | aggiorna i documenti e avvia le due run CI successive |
| `ca0896ca` | locale | sincronizza le osservazioni concorrenti nei test stale/flush |
| `e8428be9` | locale | mantiene il turno nella verifica finale del flush |

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

Sono quindi risolti i blocker di codice osservati: mossa del restore sotto
custodia, letture e callback del rebuild, rename asset ancora sincrona,
collisione e nome originale persi, attore non ripristinato, rientranza del
flush e panic di `BeforeWrite` oltre il confine di scrittura.

## Prove sul candidato

Sul commit locale `e8428be9729fd2489bbf00e445329d27ec74bb58`:

- `cargo +1.89 fmt --all -- --check`: **PASS**;
- Clippy workspace, tutti i target, `-D warnings`, Rust `1.89`: **PASS**;
- `fub-host`: 334 test verdi in 42 eseguibili;
- `git diff --check` e stato finale della validazione: **PASS/pulito**;
- i due fix rispetto all'head remoto toccano soltanto test di `fub-host`.

Sul commit antenato `1b0f13f125450b98170cf4ae17acc0b163506007`:

- call graph finale dei percorsi di produzione che attraversano
  `Custody<Workspace>`: **PASS**;
- kernel: 800 test verdi in 62 eseguibili, 1 ignorato;
- features: 350 test verdi in 36 eseguibili, 2 ignorati.

Kernel e feature non sono stati rieseguiti dopo i fix host-only: questi
risultati non vanno attribuiti a `e8428be9…`.

Le due run sullo stesso head remoto `356c2920…` sono **FAILURE**, ma ciascuna
ha un solo job fallito:

- la [run PR 34707687690](https://github.com/Fubeo/Fub/actions/runs/34707687690)
  fallisce soltanto nel job macOS `103590610888`; il test
  `an_action_from_a_replaced_view_provider_is_rejected_as_stale` scade
  aspettando l'ingresso del vecchio provider;
- la [run push 34707684943](https://github.com/Fubeo/Fub/actions/runs/34707684943)
  fallisce soltanto nel job Ubuntu `103590603150`; il test
  `opening_runner_flush_releases_custody_and_allows_host_reentry` perde
  l'asserzione finale one-shot `try_write`.

Tutti gli altri job delle due run sono verdi: Windows, fmt/Clippy,
documentazione, invarianti, client, supply chain e il job dell'altro sistema
Unix. Le cause radice sono due osservazioni non bloccanti racy, non una
violazione del confine di custodia. `ca0896ca` sincronizza le asserzioni e usa
nel provider stale l'accesso bloccante, lasciando al watchdog esistente la
diagnosi di un vero deadlock; `e8428be9` conserva esplicitamente il turno di
scrittura durante la verifica finale del flush. I fix sono test-only e non
ampliano alcun timeout.

Le run su `356c2920…` non includono questi fix e non possono certificare il
candidato locale. `ARCH-001` resta **`CANDIDATE/CI_PENDING`** e G3 non è
`CLOSED`.

## Azione successiva esatta

1. Integra con fast-forward o cherry-pick pulito questo commit documentale sopra
   `work/g3-integration` a `e8428be9…`.
2. Rifetcha la PR #32 e verifica che `356c2920...HEAD` sia ancora un
   fast-forward; in caso di drift incompatibile fermati senza reset o force.
3. Pubblica l'HEAD risultante su `fix/lifecycle-mount-detached` con push
   ordinario, mai force-push.
4. Attendi una nuova CI completa della
   [PR #32](https://github.com/Fubeo/Fub/actions?query=branch%3Afix%2Flifecycle-mount-detached)
   e accetta esclusivamente tutti i job obbligatori verdi sullo stesso nuovo SHA
   appena pubblicato.
5. Soltanto dopo quel verde aggiorna lo stato da `CANDIDATE/CI_PENDING` e valuta
   la chiusura reale di G3. Non riusare le run fallite su `356c2920…`.
6. Dopo G3, il prossimo lavoro è #8: integrare inventory e installazione
   end-to-end conformi, senza eseguibili in `.fub/plugins`; segue #10.

## Rischi e dichiarazioni lasciate aperte

Il rollback di una rename può correre contro un processo esterno:
`VaultStorage` non offre rename condizionale né reservation. La verifica
dell'identità evita di sovrascrivere alla cieca un file sostituito, ma non rende
il filesystem una transazione globale. Questo rischio resta esplicito.

Restano intenzionalmente pendenti:

- CI completa sul nuovo SHA che include i due fix e la documentazione;
- chiusura di `ARCH-001` e G3;
- pubblicazione del nuovo HEAD e merge della PR #32;
- chiusura di qualunque issue;
- G14 con la matrice completa 56/56;
- G15/GO e ogni merge in `main`.

La decisione resta **NO-GO — NOT READY FOR PHASE 9**. Anche una CI verde e la
chiusura reale di G3 non completano da sole l'audit: #8 e gli altri gate
restano nell'ordine governato dal piano.
