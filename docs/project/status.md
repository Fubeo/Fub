# Stato del progetto

> **Stato aggiornato per:** tree live certificato
> `9c5a4db2382d45ee709ada4668a840465d871c64`, 13 settembre 2026;
> `ARCH-001` e G3 chiusi su questo SHA.

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

## G3 chiuso sul tree live certificato

La [PR #32](https://github.com/Fubeo/Fub/pull/32) è **OPEN, DRAFT**, con base
`fix/audit-integration` e head `fix/lifecycle-mount-detached`. Il fetch live del
13 settembre 2026 conferma come head remoto esatto
`9c5a4db2382d45ee709ada4668a840465d871c64`.

`ARCH-001` e G3 sono **`CLOSED` sul tree `9c5a4db…`**. Sul medesimo SHA sono
verdi entrambe le CI:

- [run CI PR 34746750247](https://github.com/Fubeo/Fub/actions/runs/34746750247):
  `completed/success`, 8 job su 8;
- [run CI push 34746748272](https://github.com/Fubeo/Fub/actions/runs/34746748272):
  `completed/success`.

Tra `fbe9676a…` e il tree live certificato sono già presenti questi sei commit,
in ordine:

| Commit | Correzione |
|---|---|
| `d8e86e83` | rollback delle opening non pubblicate |
| `8a9a530f` | avvio atomico dei worker |
| `0e0441ef` | pubblicazione atomica della sessione |
| `78a89f92` | contenimento dei panic nella preparazione dei bundle |
| `440bd410` | rollback dei mount parziali |
| `9c5a4db` | isolamento dei fallimenti della scansione su nomi non UTF-8 |

Il tree certificato completa il distacco verificato delle callback di
produzione: ripristino staged con mossa e rollback fuori custodia; rename
esplicita di documenti e asset; watcher in fasi prepare/invoke/finalize; rebuild
di manutenzione staccato; flush degli indici tramite token e protezione
`IndexCall`; `BeforeWrite` eseguito e protetto dal panic prima di ogni scrittura.
Opening, pubblicazione della sessione, avvio dei worker, preparazione dei bundle,
mount, rollback, teardown e scansione non UTF-8 sono inclusi nel tree sul quale
la CI è verde.

Questa certificazione non completa l'audit. #8, #10, G14 e G15/GO restano
**OPEN**; in particolare G14 non ha ancora la matrice finale 56/56. La PR #32
resta draft. La decisione è **NO-GO — NOT READY FOR PHASE 9 — NON MERGIARE IN
`main`**.

Restano vincolanti i WIT frozen e le guardie dell'audit: niente `allow` per
Clippy, test ignorati o saltati, `sleep` usati come sincronizzazione o mutex
globale introdotto per serializzare le suite.

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
slice inventory/installazione di #8, avviato dal tree `9c5a4db…`: portare
semanticamente dalla PR #30 il solo inventario installato, mantenendo gli
eseguibili fuori da `.fub/plugins`. Non eseguire merge né cherry-pick
dell'intera PR #30; #8 e #10 restano aperte.

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
sono `CLOSED` sul tree live certificato `9c5a4db…`, con CI PR e push verdi sul
medesimo SHA. La PR #32 resta **OPEN, DRAFT**; #8, #10, G14 e G15/GO restano
aperti. Decisione: **NO-GO — NOT READY FOR PHASE 9 — NON MERGIARE IN `main`**.

## Prossimi passi

1. avviare da `9c5a4db…` lo slice inventory/installazione di #8 con un port
   semantico del solo inventario installato dalla PR #30, senza merge o
   cherry-pick dell'intera PR e senza eseguibili in `.fub/plugins`; mantenere
   aperte #8 e #10;
2. completare ripristino atomico e backup/restore #5/#7;
3. separare e misurare la Graph View con #12/#6;
4. completare le evidenze manuali e ripetibili di #17;
5. proseguire dalle fasi 5–10 del
   [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md),
   tracciato in #11, senza rifare le fasi 0–4;
6. completare il contratto dei temi #13;
7. decidere esplicitamente se #9 blocca la prima release e verificarla oppure
   motivarne il rinvio senza chiuderla artificialmente;
8. completare la matrice G14 e ottenere un G15/GO esplicito prima di
   autorizzare qualunque merge finale in `main`.

## Fonti

- [Roadmap](roadmap.md)
- [M5](m5-wasm-runtime.md)
- [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md)
- [Changelog](../../CHANGELOG.md)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
