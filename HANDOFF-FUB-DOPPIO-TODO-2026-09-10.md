# HANDOFF — completare G3, audit e superfici di editing

Questo è l'handoff operativo corrente al 10 settembre 2026 per `Fubeo/Fub`.
Non autorizza il merge in `main` e non dichiara G3 concluso.

## Fonti e regole vincolanti

Prima di modificare il repository, leggere:

1. [`PIANO-AZIONE-FUB-AUDIT-2026-09-01.md`](PIANO-AZIONE-FUB-AUDIT-2026-09-01.md), che governa i 56 finding, C-01..C-10 e G0..G15;
2. [`docs/project/todo-superfici-di-editing-condivise.md`](docs/project/todo-superfici-di-editing-condivise.md), che governa le superfici condivise;
3. `AGENTS.md`, `CONTRIBUTING.md` e la documentazione canonica dell'area toccata.

Valgono sempre le regole più restrittive dell'audit: nessun callback provider o
codice esterno sotto `Custody<Workspace>`, nessuna scorciatoia tramite
`Host::workspace`, nessuna modifica ai WIT frozen, nessun CodeRabbit, force-push,
reset distruttivo o indebolimento dei test. Non modificare `main` prima di
G15/GO esplicito.

## Stato live verificato

Dopo il refetch del 10 settembre 2026:

- `main`: `cf50f60fd17e53d11e74ff2e7af96d572f69b10e`;
- base audit `fix/audit-integration`: `7efc4375a7167ea3df5070673c6c2163a758a0f2`;
- [`PR #32`](https://github.com/Fubeo/Fub/pull/32): **OPEN, DRAFT**, base
  `fix/audit-integration`, head `fix/lifecycle-mount-detached`;
- head remoto della PR #32:
  `6dacd4995e65adc2a2c17bca8e338c48d2dfb898`;
- branch locale di consegna: `work/g3-integration`, HEAD pre-documento
  `57264701a34506c8d47945485c6c4fbb144a7b18`;
- intervallo locale consegnato:
  `6dacd4995e65adc2a2c17bca8e338c48d2dfb898..57264701a34506c8d47945485c6c4fbb144a7b18`;
- divergenza locale rispetto all'head remoto: **53 commit avanti, 0 indietro**;
  l'aggiornamento è fast-forward.

Rifetcha sempre questi riferimenti prima di scrivere o pubblicare. Gli SHA di
questo documento sono uno snapshot utile a rilevare drift, non istruzioni di
reset. Se l'head remoto della PR non è più `6dacd499…`, confronta la nuova
storia e integra solo se compatibile.

## CI già osservata

La run principale
[`34458491074`](https://github.com/Fubeo/Fub/actions/runs/34458491074) e la
[NPM supply chain `34458491070`](https://github.com/Fubeo/Fub/actions/runs/34458491070)
hanno chiuso verdi tutti i 18 job, ma certificano **soltanto**
`6dacd4995e65adc2a2c17bca8e338c48d2dfb898`.

I 53 commit locali e il successivo commit documentale non sono certificati da
quel verde. Dopo il push deve partire una nuova CI completa sul nuovo identico
SHA; non riusare il risultato del vecchio candidato.

## Lavoro G3 locale consegnato

Il range locale contiene:

- ripristino legacy portato al protocollo staged;
- autorizzazione del restore prima di leggere la sorgente;
- letture di sorgente, parser e feed successivi del restore eseguiti fuori
  dalla custodia;
- watcher diviso in prepare/invoke/finalize, riconoscimento delle sole rename
  tracciate e flush consapevole degli errori parziali;
- `JobHost` con `DataRead`, `DataWrite` e `SettingsWrite` staccati;
- trash ed empty-trash staged con rollback;
- ordine degli eventi di rimozione corretto;
- parser della rename esplicita, feed backlink/identity, side-data, operazioni
  file e journal staccati, con rollback.

I punti principali da rileggere sono
[`crates/fub-kernel/src/workspace.rs`](crates/fub-kernel/src/workspace.rs),
[`crates/fub-kernel/src/workspace/restore.rs`](crates/fub-kernel/src/workspace/restore.rs),
[`crates/fub-host/src/jobs.rs`](crates/fub-host/src/jobs.rs) e
[`crates/fub-host/src/watcher.rs`](crates/fub-host/src/watcher.rs).

L'ultimo tentativo di introdurre `RestoreMoveDetachedImpl` è stato fermato
prima di scrivere: non esiste una sua implementazione parziale da conservare.

## Blocker residuo di G3

G3 è ancora aperto. `commit_document_restore` esegue ancora sotto `Custody`:

1. il nuovo controllo della lista;
2. il nuovo controllo della revisione;
3. `restore_trashed`, cioè la move effettiva.

La prossima modifica deve introdurre una move detached con rollback esatto:
preparare e validare lo stato sotto custodia, rilasciare la custodia, eseguire
la move esterna, poi finalizzare o ripristinare esattamente lo stato precedente
in caso di conflitto/errore. Non sostituire il problema con un controllo
speciale dell'input e non perdere i token necessari al rollback.

Dopo la correzione, rieseguire il call graph completo: i messaggi di commit e i
soli percorsi production non bastano a chiudere `ARCH-001`/C-04.

Resta inoltre un rischio noto nella rename: il rollback può correre contro un
processo esterno, perché `VaultStorage` non offre rename condizionale né
reservation. Non presentare questo rischio come risolto.

## Prove effettivamente eseguite

Le verifiche locali più recenti sono:

- restore kernel: 3/3;
- `read_model_lock`: 20/20;
- `index_feed_lock`: 6/6;
- trash: 28/28;
- `index_removal_lock`: 4/4;
- `event_handler_lock`: 12/12;
- `slow_rename`: 9/9;
- aggregato rename + journal: 56/56;
- `fub-host --lib`: 81/81 su uno stato intermedio;
- `fub-features`: 350 pass, 2 ignored su uno stato intermedio.

Non sono state rieseguite le suite complete kernel, host o features sull'HEAD
`57264701…`. Non attribuire quindi quei risultati all'intero range finale.

Clippy locale è bloccato da tre occorrenze di `chunks_exact_to_as_chunks` in
`fub-abi/src/edit.rs`. Questo è un limite della verifica locale, non
un'autorizzazione ad aggiungere allow o a indebolire test. La vecchia CI verde
non certifica il tree locale.

## Azione successiva esatta

1. Rifetcha `main`, `fix/audit-integration`,
   `fix/lifecycle-mount-detached` e la PR #32.
2. Verifica che la PR remota sia ancora a `6dacd499…` e che
   `6dacd499…..HEAD` resti un fast-forward; in caso di drift incompatibile,
   fermati senza reset o force.
3. Implementa soltanto la move detached e il rollback esatto di
   `commit_document_restore`.
4. Riesegui il call graph audit e le regressioni mirate, poi le suite complete
   kernel, host e features sul candidato finale.
5. Aggiorna solo allora piano, matrice e documentazione canonica in base alle
   prove reali; non anticipare la chiusura di G3.
6. Pubblica con push ordinario dell'HEAD candidato su
   `fix/lifecycle-mount-detached`; mai force-push.
7. Controlla la [CI della PR #32](https://github.com/Fubeo/Fub/actions?query=branch%3Afix%2Flifecycle-mount-detached)
   e accetta solo tutti i job obbligatori verdi sullo stesso nuovo SHA.

## Gate, issue e ordine successivo

Nessuna issue è chiudibile ora. La decisione resta **NO-GO — NOT READY FOR
PHASE 9**.

Dopo la chiusura reale di G3:

1. rifetcha la PR #30 e completa #8 portando solo inventory/install conforme,
   senza eseguibili in `.fub/plugins`;
2. completa #10;
3. prosegui con #5/#7, poi #12/#6, poi #17;
4. completa #11 dalle fasi 5–10 senza rifare le fasi 0–4 già concluse;
5. completa #13;
6. prendi una decisione esplicita e motivata su #9;
7. prepara e verifica la prima release;
8. completa G14 con 56/56 finding e infine G15/GO.

Audit, superfici condivise e roadmap devono essere tutti completi. Un singolo
checkpoint verde, la sola chiusura di G3 o l'integrazione della PR #32 non sono
condizioni di uscita.
