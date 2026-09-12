# Stato del progetto

> **Stato aggiornato per:** candidato locale G3 al commit
> `e8428be9729fd2489bbf00e445329d27ec74bb58`, 12 settembre 2026.

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
Il piano audit non è completato: le spunte G3 riportano prove locali sul
candidato, non chiudono il gate né i finding ancora privi di evidenza finale.

## Candidato G3 della linea audit

La [PR #32](https://github.com/Fubeo/Fub/pull/32) è **OPEN, DRAFT**, con base
`fix/audit-integration` e head `fix/lifecycle-mount-detached`. Dopo il fetch del
12 settembre, `origin/main` è
`cf50f60fd17e53d11e74ff2e7af96d572f69b10e`, la base remota è
`7efc4375a7167ea3df5070673c6c2163a758a0f2` e l'head remoto della PR è
`356c2920d9bbefeecd30317e6ec2a9cabb8cbb46`. Il candidato locale
`work/g3-integration` è
`e8428be9729fd2489bbf00e445329d27ec74bb58`: **2 commit avanti e 0 indietro**,
quindi il delta è pubblicabile con un normale fast-forward dopo l'integrazione
del nuovo commit documentale. Nessun push o merge è implicito in questo stato.

Il candidato completa il distacco verificato delle callback di produzione:
ripristino staged con mossa e rollback fuori custodia; rename esplicita di
documenti e asset con I/O, parser, feed, side-data e journal staccati; watcher
in fasi prepare/invoke/finalize; rebuild di manutenzione staccato; flush degli
indici tramite token e protezione `IndexCall`; `BeforeWrite` eseguito e protetto
dal panic prima di ogni scrittura. Mount, rollback, teardown e chiamate dirette
del registry fanno parte del call graph finale verificato, non sono più
un'eccezione dichiarata.

Le due run sullo stesso head remoto `356c2920…` sono fallite per due sole
osservazioni non bloccanti e racy nei test:

- la [run PR 34707687690](https://github.com/Fubeo/Fub/actions/runs/34707687690)
  è fallita soltanto nel job macOS `103590610888`: timeout di
  `an_action_from_a_replaced_view_provider_is_rejected_as_stale` in attesa
  dell'ingresso del vecchio provider;
- la [run push 34707684943](https://github.com/Fubeo/Fub/actions/runs/34707684943)
  è fallita soltanto nel job Ubuntu `103590603150`:
  `opening_runner_flush_releases_custody_and_allows_host_reentry` ha perso
  l'asserzione finale one-shot `try_write`.

Tutti gli altri job delle due run sono verdi, inclusi Windows, fmt/Clippy,
documentazione, invarianti, client, supply chain e il job dell'altro sistema
Unix. `ca0896ca` sincronizza le osservazioni concorrenti e sostituisce nel
provider stale l'accesso non bloccante con quello bloccante, governato dal
watchdog esistente; `e8428be9` mantiene il turno di scrittura durante la
verifica finale del flush. I due fix sono test-only, non ampliano timeout e non
segnalano una violazione del confine di custodia.

Sul commit `e8428be9…` sono verdi:

- `cargo +1.89 fmt --all -- --check`;
- Clippy dell'intero workspace, tutti i target, con `-D warnings`;
- `fub-host`: 334 test verdi in 42 eseguibili.

La revisione finale del call graph e le ultime suite complete di `fub-kernel`
(800 test in 62 eseguibili, 1 ignorato) e delle feature (350 test in 36
eseguibili, 2 ignorati) risalgono all'antenato di codice `1b0f13f…`; kernel e
feature non sono stati rieseguiti dopo i fix host-only e non vanno attribuiti a
`e8428be9…`.

Le run su `356c2920…` non includono i due fix e non possono certificare il
candidato locale. Dopo questo aggiornamento documentale serve un push ordinario
e una nuova CI completa sul nuovo SHA pubblicato. Fino a tutti i job
obbligatori verdi sul medesimo SHA, la PR resta draft, `ARCH-001` è
**`CANDIDATE/CI_PENDING`**, G3 non è `CLOSED`, nessuna issue si chiude e
G15/GO resta aperto.

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

La PR #32 contiene il candidato locale del lifecycle conforme al confine G3,
ma non è una capacità consegnata su `main` e non chiude #8. Dopo il verde della
CI sullo SHA finale e la chiusura reale di G3, il prossimo incremento è #8:
inventory e installazione end-to-end conformi, senza eseguibili in
`.fub/plugins`.

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

Il merge in `main` è bloccato dal gate audit. Il candidato G3 è
`CANDIDATE/CI_PENDING`: fmt, Clippy workspace e suite host sono verdi localmente
su `e8428be9…`, ma soltanto tutti i job obbligatori verdi sullo stesso SHA
finale possono consentire la chiusura di G3. Anche allora servono i gate
successivi e G15/GO esplicito.

## Prossimi passi

1. integrare questo commit documentale sopra `e8428be9…`, pubblicare l'head
   risultante sulla PR #32 con push ordinario e attendere una nuova CI completa
   sul medesimo SHA;
2. solo dopo quel verde, chiudere realmente G3 e passare a #8 per inventory e
   installazione end-to-end conformi; quindi completare #10;
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
