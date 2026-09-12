# Stato del progetto

> **Stato aggiornato per:** fix test-only locale
> `c97c994b929a9f2fdb1692dd3ef5ce6eeab95074`, 12 settembre 2026;
> chiusura G3 con provenienza su `f626dfca8a3c5271f64ec14368e10d09af8f937d`.

## Governance di integrazione

Il piano `PIANO-AZIONE-FUB-AUDIT-2026-09-01.md` della linea
`fix/audit-integration` resta operativo. La roadmap non lo ritira e il verde
di una PR basata su `main` non costituisce un'autorizzazione al merge.

**NOT READY FOR PHASE 9 — NON MERGIARE IN `main`.**

La riconciliazione del 9 settembre ha confrontato `main` indicato sopra con
`fix/audit-integration` a `1b1187065e65b8ebec72996adc700c95208ff0a3`:
l'antenato comune è `96eba1695bcb8b92af3cd8e70c1b085f10e849c9` e la linea
audit conserva 284 commit assenti da `main`. I due commit esclusivi di `main`
comprendono la correzione #22 e il suo merge: vanno preservati, non riaperti
come un nuovo bug.

Gli incrementi vengono riconciliati e verificati sulla linea audit, senza
sovrascriverne i contratti. Il passaggio a `main` richiede G0–G14 e un G15/GO
esplicito sul candidato corrente, seguito dalla verifica dello SHA integrato.
`ARCH-001` e G3 sono chiusi, ma il piano audit non è completato e i finding
ancora privi di evidenza finale restano aperti.

## G3 chiuso sulla linea audit

La [PR #32](https://github.com/Fubeo/Fub/pull/32) è **OPEN, DRAFT**, con base
`fix/audit-integration` e head `fix/lifecycle-mount-detached`. Dopo il fetch del
12 settembre, l'head remoto esatto è
`c17467edc908ea88e57719e980e7e91b2363b77b`. Il worktree
`work/g3-integration` parte da
`c97c994b929a9f2fdb1692dd3ef5ce6eeab95074`, `1` commit avanti e `0` indietro
rispetto al remoto. `origin/fix/audit-integration` è
`7efc4375a7167ea3df5070673c6c2163a758a0f2`; il candidato locale è `91`
commit avanti e `0` indietro rispetto a quella base.

Il candidato completa il distacco verificato delle callback di produzione:
ripristino staged con mossa e rollback fuori custodia; rename esplicita di
documenti e asset con I/O, parser, feed, side-data e journal staccati; watcher
in fasi prepare/invoke/finalize; rebuild di manutenzione staccato; flush degli
indici tramite token e protezione `IndexCall`; `BeforeWrite` eseguito e protetto
dal panic prima di ogni scrittura. Mount, rollback, teardown e chiamate dirette
del registry fanno parte del call graph finale verificato, non sono più
un'eccezione dichiarata.

La provenienza della chiusura `ARCH-001` e G3 rimane il candidato certificato
`f626dfca8a3c5271f64ec14368e10d09af8f937d`: su quello SHA le run CI PR
`34709566271` e push `34709564735` sono `success`, entrambe 8 job su 8, e le
run NPM PR `34709566259` e push `34709564653` sono `success`.

Sul successivo head remoto
`c17467edc908ea88e57719e980e7e91b2363b77b`:

- [run CI push 34713518784](https://github.com/Fubeo/Fub/actions/runs/34713518784):
  `completed/success`, 8 job su 8;
- [run CI PR 34713519450](https://github.com/Fubeo/Fub/actions/runs/34713519450):
  `completed/failure`; il solo job macOS `103606458363` è fallito, mentre gli
  altri sette job e tutti gli altri sistemi/casi di test sono verdi;
- [run NPM push 34713518782](https://github.com/Fubeo/Fub/actions/runs/34713518782)
  e [run NPM PR 34713519528](https://github.com/Fubeo/Fub/actions/runs/34713519528):
  `completed/success`.

Nel job macOS della CI PR il test
`opening_runner_flush_rejects_same_provider_reentry_and_releases_its_guard` è
fallito in `runtime_index_flush_lock.rs:252`: la verifica finale usava un solo
`try_write`. Il turno del writer impediva che un altro writer lo superasse, ma
non escludeva un reader concorrente estraneo alla probe; quel reader poteva
quindi far fallire l'osservazione non bloccante anche dopo il completamento del
flush. Non è una violazione del confine di custodia.

`c97c994b929a9f2fdb1692dd3ef5ce6eeab95074` corregge soltanto la probe: usa
l'acquisizione bloccante della custodia per verificare il rilascio finale e
rilascia immediatamente la guardia prima di `host.close()`. Il comportamento
G3/ARCH di produzione e la provenienza della chiusura restano invariati.

Sul candidato locale esatto `c97c994b929a9f2fdb1692dd3ef5ce6eeab95074`
sono verdi:

- `cargo +1.89 fmt --all -- --check`;
- Clippy dell'intero workspace, tutti i target, con `-D warnings`;
- `fub-host`: 334 test verdi in 42 eseguibili;
- `git diff --check`, con stato finale della validazione pulito.

La revisione finale del call graph e le ultime suite complete di `fub-kernel`
(800 test in 62 eseguibili, 1 ignorato) e delle feature (350 test in 36
eseguibili, 2 ignorati) risalgono all'antenato di codice `1b0f13f…`; kernel e
feature non sono stati rieseguiti per `c97c994b` e non vanno attribuiti al
candidato locale.

Il candidato per la pubblicazione resta **`CI_PENDING`**. Il prossimo passo
esatto è integrare questo commit documentale sopra `c97c994b…`, rifetchare la
PR #32 e verificare che l'head remoto sia ancora `c17467ed…`, quindi pubblicare
l'head risultante su `fix/lifecycle-mount-detached` con push ordinario. Le nuove
CI PR e push devono completarsi interamente verdi sul medesimo nuovo SHA prima
che la PR diventi ready o che lo stato finale sia pubblicato. Nessuna issue
viene chiusa, G15/GO resta aperto e non è autorizzato alcun merge in `main`.

Il rischio residuo reale è il rollback di una rename in concorrenza con un
processo esterno: `VaultStorage` non offre rename condizionale né reservation.
Il candidato verifica l'identità osservata del file, ma non promette una
transazione globale contro modifiche esterne.

## Release corrente

Fub non ha ancora pubblicato un tag. Il workspace e la shell dichiarano
`0.1.0`; il contratto plugin è `fub:abi@0.1.1`.

Milestone 1–4 sono assorbite nel prodotto e nell'architettura correnti.
Milestone 5, runtime WASM, è in corso.

## CI e qualità visuale

La regressione del fallback dei blocchi Markdown personalizzati è risolta in
[PR #22](https://github.com/Fubeo/Fub/pull/22). La
[run di riferimento del 6 settembre](https://github.com/Fubeo/Fub/actions/runs/34039818672)
è verde sul commit indicato: test Rust sulle piattaforme supportate, frontend,
baseline visuali e accessibilità. La correzione non rigenera le immagini e non
cambia le soglie del banco.

[#17](https://github.com/Fubeo/Fub/issues/17) resta il tracker unico delle
baseline; #16 è stata assorbita come duplicata. Prima della chiusura servono
provenienza e revisione delle immagini, esame del foglio di contatto nelle due
luci, due esecuzioni consecutive nello stesso ambiente, confronto delle
soglie, diagnosi del drift e correzione del commento storico del banco.
Il verde automatico non sostituisce queste evidenze.

## Implementato

### Core e storage

- workspace local-first;
- modello comune del documento;
- provider Markdown;
- CRUD del vault, rename e cestino;
- revisioni, bozze e versioning;
- anagrafe, organizzazione, impostazioni e journal;
- apertura a fasi con file non letti dichiarati;
- eventi accodati e job cancellabili.

### Conoscenza e shell

- ricerca full-text;
- wikilink, tag, backlink, outline e proprietà;
- Graph View;
- motore testuale CodeMirror condiviso e profili Markdown/plain text;
- sorgente, live preview e lettura;
- più riquadri e `DocumentSession` condivisa;
- UI dichiarativa, comandi e impostazioni;
- tema generato, banco visuale e accessibilità.

### Estensibilità

- trait condivisi in `fub-abi`;
- WIT vivo e frozen;
- feature ufficiali indipendenti;
- provider nativi;
- component model Wasmtime;
- lifecycle `Plugin` e `CommandProvider` WASM;
- capability, timeout, memoria ed errori tipizzati.

## In corso

### M5

- provider WASM aggiuntivi;
- `ViewProvider` e validazione della UI non fidata;
- discovery, installazione e teardown end-to-end;
- esempio non banale.

La PR #32 contiene il lifecycle conforme al confine G3, ma non è una capacità
consegnata su `main` e non chiude #8. Il prossimo incremento funzionale è lo
slice 1 di #8: portare semanticamente dalla PR #30 l'inventario installato,
adattandolo alla linea G3 corrente e mantenendo gli eseguibili fuori da
`.fub/plugins`. Non eseguire merge né cherry-pick dell'intera PR #30; #8 e #10
restano aperte.

Issue:

- [#8 — percorso end-to-end per un plugin WASM](https://github.com/Fubeo/Fub/issues/8)
- [#10 — provider WASM e UI non fidata](https://github.com/Fubeo/Fub/issues/10)

### Qualità e resilienza

- [#5 — ripristino atomico degli snapshot del database](https://github.com/Fubeo/Fub/issues/5)
- [#6 — prova di scala e durata della Graph View](https://github.com/Fubeo/Fub/issues/6)
- [#7 — esercitazione di backup e ripristino](https://github.com/Fubeo/Fub/issues/7)
- [#9 — endurance e riconciliazione della sincronizzazione](https://github.com/Fubeo/Fub/issues/9)
- [#17 — evidenze e stabilità delle baseline visuali](https://github.com/Fubeo/Fub/issues/17)

### Architettura della shell

- [#11 — superfici di editing condivise](https://github.com/Fubeo/Fub/issues/11)
  ([piano operativo](todo-superfici-di-editing-condivise.md))
- [#12 — modularizzazione della Graph View 2.0](https://github.com/Fubeo/Fub/issues/12)
- [#13 — contratto dei temi e consegna agli autori](https://github.com/Fubeo/Fub/issues/13)

Per #11 le fasi 0–4 sono concluse su `main`. Il prossimo passo è
`DocumentSurfaceRegistry`; seguono modalità e tastiera, `.fubsheet`, griglia,
misura del protocollo e soltanto dopo ABI/WIT. Il TODO conserva i criteri delle
fasi 5–10: l'estrazione iniziale non va ripetuta.

## Bloccato

Il merge in `main` resta bloccato dai gate audit successivi. `ARCH-001` e G3
sono `CLOSED` con provenienza su `f626dfca…`; il candidato di pubblicazione è
`CI_PENDING`: su `c17467ed…` la CI push è verde 8/8, ma la CI PR
`34713519450` è fallita soltanto nella probe racy su macOS; il nuovo SHA con
`c97c994b` richiede nuove CI PR e push interamente verdi.
La PR #32 resta draft; #8, #10, G14 e G15/GO restano aperti.

## Prossimi passi

1. integrare questo aggiornamento sopra `c97c994b…`, rifetchare e verificare
   l'head remoto `c17467ed…`, quindi pubblicare con push ordinario il nuovo SHA
   e attendere CI PR e push interamente verdi sul medesimo commit prima di
   rendere la PR #32 ready o pubblicare lo stato finale;
2. avviare lo slice 1 di #8 con un port semantico dell'inventario installato
   dalla PR #30 sulla linea G3 corrente, senza merge o cherry-pick dell'intera
   PR; mantenere aperte #8 e #10;
3. completare ripristino atomico e backup/restore #5/#7;
4. separare e misurare la Graph View con #12/#6;
5. completare le evidenze manuali e ripetibili di #17;
6. proseguire dalle fasi 5–10 del
   [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md),
   tracciato in #11, senza rifare le fasi 0–4;
7. completare il contratto dei temi #13;
8. decidere esplicitamente se #9 blocca la prima release e verificarla oppure
   motivarne il rinvio senza chiuderla artificialmente;
9. preparare la prima release secondo le regole di versionamento correnti e
   completare G14/G15 prima di autorizzare il merge finale in `main`.

## Fonti

- [Roadmap](roadmap.md)
- [M5](m5-wasm-runtime.md)
- [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md)
- [Changelog](../../CHANGELOG.md)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
