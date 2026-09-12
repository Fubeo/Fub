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
  `c363d32cfc69166a9cd7f62c031c64a5541346fa`;
- branch locale di consegna: `work/g3-integration`, HEAD di codice
  pre-documentazione `1b0f13f125450b98170cf4ae17acc0b163506007`;
- intervallo da pubblicare prima del commit documentale:
  `c363d32cfc69166a9cd7f62c031c64a5541346fa..1b0f13f125450b98170cf4ae17acc0b163506007`;
- divergenza: **14 commit avanti, 0 indietro**; l'aggiornamento è
  fast-forward.

Rifetcha questi riferimenti prima della pubblicazione. Gli SHA sono uno snapshot
per rilevare drift, non istruzioni di reset. Se l'head remoto della PR non è più
`c363d32c…`, confronta la storia e integra soltanto se il nuovo head è
compatibile.

## Candidato consegnato

I 14 commit locali sopra l'head remoto sono:

| Commit | Contenuto verificato |
|---|---|
| `14007bf6` | corregge il riferimento documentale al sidecar |
| `a7c6dce0` | allinea i lint del workspace senza deroghe |
| `ba78d17d` | sposta fuori custodia la mossa del ripristino |
| `5debdbbe` | vincola il rollback della rename all'identità del file |
| `7e6bfc0e` | stacca operazioni globali e dry run |
| `e2c8dff2` | stacca il rebuild di manutenzione |
| `89ac082b` | ripristina l'attore dopo il drain degli eventi |
| `47a7f38a` | conserva la collisione tipizzata nella rename |
| `0f3e4961` | ripristina il nome originale già esistente |
| `774b56b4` | fissa nel banco il ruolo del mutex del watcher |
| `9839ee6b` | impedisce la rientranza nel flush degli indici |
| `6b1058dd` | stacca la rename esplicita degli asset |
| `35c69d35` | impedisce la rientranza nel flush sincrono |
| `1b0f13f1` | cattura il panic di `BeforeWrite` prima della scrittura |

Il comportamento risultante comprende:

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

## Prove locali sul candidato di codice

Sul commit `1b0f13f125450b98170cf4ae17acc0b163506007`:

- `cargo fmt --all -- --check`: **PASS**;
- call graph finale dei percorsi di produzione che attraversano
  `Custody<Workspace>`: **PASS**;
- kernel: 800 test verdi in 62 eseguibili, 1 ignorato;
- host: 334 test verdi in 42 eseguibili;
- features: 350 test verdi in 36 eseguibili, 2 ignorati;
- totale: 1484 test verdi in 140 eseguibili, 3 ignorati.

Il Clippy workspace locale non è verde esclusivamente per tre occorrenze
preesistenti di `chunks_exact_to_as_chunks` in
`crates/fub-abi/src/edit.rs:255`, `:257` e `:296`. Non aggiungere `allow`, non
cambiare toolchain e non presentare questo limite come una correzione richiesta
al candidato G3.

Nessuna CI precedente certifica `1b0f13f…` o il successivo commit documentale.
Per questo `ARCH-001` è **`CANDIDATE/CI_PENDING`** e G3 non è `CLOSED`.

## Azione successiva esatta

1. Integra con fast-forward o cherry-pick pulito il commit documentale che
   contiene questo handoff sopra `work/g3-integration` a `1b0f13f…`.
2. Rifetcha la PR #32 e verifica che `c363d32c...HEAD` sia ancora un
   fast-forward; in caso di drift incompatibile fermati senza reset o force.
3. Pubblica l'HEAD risultante su `fix/lifecycle-mount-detached` con push
   ordinario, mai force-push.
4. Attendi la CI completa della
   [PR #32](https://github.com/Fubeo/Fub/actions?query=branch%3Afix%2Flifecycle-mount-detached)
   e accetta esclusivamente tutti i job obbligatori verdi sullo stesso SHA
   pubblicato.
5. Soltanto dopo quel verde aggiorna lo stato da `CANDIDATE/CI_PENDING` e valuta
   la chiusura reale di G3. Non riusare una run di un commit precedente.
6. Dopo G3, il prossimo lavoro è #8: integrare inventory e installazione
   end-to-end conformi, senza eseguibili in `.fub/plugins`; segue #10.

## Rischi e dichiarazioni lasciate aperte

Il rollback di una rename può correre contro un processo esterno:
`VaultStorage` non offre rename condizionale né reservation. La verifica
dell'identità evita di sovrascrivere alla cieca un file sostituito, ma non rende
il filesystem una transazione globale. Questo rischio resta esplicito.

Restano intenzionalmente pendenti:

- Clippy `-D warnings` verde in locale, per i tre lint preesistenti indicati;
- CI completa sullo SHA che include codice e documentazione;
- chiusura di `ARCH-001` e G3;
- pubblicazione e merge della PR #32;
- chiusura di qualunque issue;
- G14 con la matrice completa 56/56;
- G15/GO e ogni merge in `main`.

La decisione resta **NO-GO — NOT READY FOR PHASE 9**. Anche una CI verde e la
chiusura reale di G3 non completano da sole l'audit: #8 e gli altri gate
restano nell'ordine governato dal piano.
