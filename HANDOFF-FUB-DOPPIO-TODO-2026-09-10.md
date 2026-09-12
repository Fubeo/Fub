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
  `a8d5771402f1b8ef682ee5807e5732c16a329289`;
- branch locale di consegna: `work/g3-integration`, HEAD
  `a0b77232972a0e5f7c316d0585d460c326fd9d07`;
- intervallo locale non pubblicato:
  `a8d5771402f1b8ef682ee5807e5732c16a329289..a0b77232972a0e5f7c316d0585d460c326fd9d07`;
- divergenza: **3 commit avanti, 0 indietro**; il delta è fast-forward.

Rifetcha questi riferimenti prima della pubblicazione. Gli SHA sono uno snapshot
per rilevare drift, non istruzioni di reset. Se l'head remoto della PR non è più
`a8d57714…`, confronta la storia e integra soltanto se il nuovo head è
compatibile.

## Candidato e fix locali

L'head remoto `a8d57714` contiene già il candidato di codice fino a `1b0f13f1`
e il primo commit documentale. I tre commit locali successivi, tutti limitati a
`fub-host`, sono:

| Commit | Origine | Correzione |
|---|---|---|
| `7e3719f2` | CI 34706406133: Clippy `large_enum_variant` nel watcher | riduce la variante documentale |
| `27808660` | successivo Clippy locale con Rust `1.89`: import inutilizzato | rimuove l'import dal test |
| `a0b77232` | test watcher macOS/Windows: radice canonica confrontata con path non canonico | canonicalizza la radice nel test |

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

Sul commit locale `a0b77232972a0e5f7c316d0585d460c326fd9d07`:

- `cargo +1.89 fmt --all -- --check`: **PASS**;
- Clippy workspace, tutti i target, `-D warnings`, Rust `1.89`: **PASS**;
- `fub-host`: 334 test verdi in 42 eseguibili;
- i tre fix rispetto all'head remoto toccano soltanto `fub-host`.

Sul commit antenato `1b0f13f125450b98170cf4ae17acc0b163506007`:

- call graph finale dei percorsi di produzione che attraversano
  `Custody<Workspace>`: **PASS**;
- kernel: 800 test verdi in 62 eseguibili, 1 ignorato;
- features: 350 test verdi in 36 eseguibili, 2 ignorati.

Kernel e feature non sono stati rieseguiti dopo i tre fix host-only: questi
risultati non vanno attribuiti ad `a0b77232…`.

La [run CI 34706406133](https://github.com/Fubeo/Fub/actions/runs/34706406133)
su `a8d57714…` è **FAILURE**: rustfmt era passato, mentre Clippy aveva rilevato
la variante grande corretta da `7e3719f2`. Nessuna CI certifica ancora i tre fix
locali né il nuovo commit documentale. Per questo `ARCH-001` resta
**`CANDIDATE/CI_PENDING`** e G3 non è `CLOSED`.

## Azione successiva esatta

1. Integra con fast-forward o cherry-pick pulito questo nuovo commit
   documentale sopra `work/g3-integration` a `a0b77232…`.
2. Rifetcha la PR #32 e verifica che `a8d57714...HEAD` sia ancora un
   fast-forward; in caso di drift incompatibile fermati senza reset o force.
3. Pubblica l'HEAD risultante su `fix/lifecycle-mount-detached` con push
   ordinario, mai force-push.
4. Attendi una nuova CI completa della
   [PR #32](https://github.com/Fubeo/Fub/actions?query=branch%3Afix%2Flifecycle-mount-detached)
   e accetta esclusivamente tutti i job obbligatori verdi sullo stesso SHA
   appena pubblicato.
5. Soltanto dopo quel verde aggiorna lo stato da `CANDIDATE/CI_PENDING` e valuta
   la chiusura reale di G3. Non riusare la run fallita sul commit precedente.
6. Dopo G3, il prossimo lavoro è #8: integrare inventory e installazione
   end-to-end conformi, senza eseguibili in `.fub/plugins`; segue #10.

## Rischi e dichiarazioni lasciate aperte

Il rollback di una rename può correre contro un processo esterno:
`VaultStorage` non offre rename condizionale né reservation. La verifica
dell'identità evita di sovrascrivere alla cieca un file sostituito, ma non rende
il filesystem una transazione globale. Questo rischio resta esplicito.

Restano intenzionalmente pendenti:

- CI completa sul nuovo SHA che include i tre fix e la documentazione;
- chiusura di `ARCH-001` e G3;
- pubblicazione del nuovo HEAD e merge della PR #32;
- chiusura di qualunque issue;
- G14 con la matrice completa 56/56;
- G15/GO e ogni merge in `main`.

La decisione resta **NO-GO — NOT READY FOR PHASE 9**. Anche una CI verde e la
chiusura reale di G3 non completano da sole l'audit: #8 e gli altri gate
restano nell'ordine governato dal piano.
