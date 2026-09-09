# Stato del progetto

> **Stato aggiornato per:** `main` al commit
> `cf50f60fd17e53d11e74ff2e7af96d572f69b10e`, 9 settembre 2026.

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
Il piano audit non è completato: la matrice conserva finding senza evidenza
finale. Nessun gate viene spuntato per effetto di questo riallineamento.

## Candidati della linea audit

La [PR #25](https://github.com/Fubeo/Fub/pull/25) è stata integrata nella sola
linea audit con fast-forward a `65a0cce5ed849fc8eba46b12f88a6aa23a07a0eb`,
dopo il verde completo delle run push e PR sullo stesso SHA. Preserva #22,
i 284 commit esclusivi audit e i due esclusivi di `main`.

Il candidato di questa documentazione include anche la sola discovery della
[PR #26](https://github.com/Fubeo/Fub/pull/26), al commit
`77e1b8783fbba75364644078b0735a5b709de28d`. Le prove e il gate di integrazione
sono registrati nella PR: il codice di discovery non completa il lifecycle.
Ogni avanzamento della linea audit richiede i controlli applicabili sullo SHA
effettivo; nessuna di queste integrazioni autorizza a spostare `main`.

Il candidato CAS `4b3bd77e2b7af5584a56ba3a3556e1ade99e5976` corregge l'apertura
concorrente del lock nuovo. La diagnostica precedente identifica `open_lock`
come stadio dell'errore `ENOENT`; il protocollo usa creazione esclusiva e apre
un file esistente soltanto dopo `AlreadyExists`. I due test CAS sono verdi sui
tre sistemi nelle run
[push](https://github.com/Fubeo/Fub/actions/runs/34388493276) e
[PR](https://github.com/Fubeo/Fub/actions/runs/34388497315), entrambe concluse
con successo in tutti gli otto job. Anche il candidato di riconciliazione
`65a0cce` ha superato entrambe le run
[push](https://github.com/Fubeo/Fub/actions/runs/34391260104) e
[PR](https://github.com/Fubeo/Fub/actions/runs/34391266023).
Queste prove non certificano automaticamente un successivo SHA.

C-04/G3 resta aperto: oltre al banco WASM, anche mount, abilitazione, rollback
e teardown di produzione richiedono callback fuori da `Custody<Workspace>`.
La revisione deve includere le chiamate indirette e i disposer dei provider.
G14 conserva specifiche originali non ricostruite: la ricerca nella cronologia
e nei tracker accessibili non consente di assegnarle per intuizione.

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

La [PR #23](https://github.com/Fubeo/Fub/pull/23) propone il primo incremento
nativo di discovery e lifecycle. La CI del suo candidato `66141ad` è conclusa
con successo, ma la PR resta draft: il banco deve usare i confini di mount e
invocazione della linea audit senza callback sotto `Custody<Workspace>`.
Non è una capacità consegnata su `main` e non chiude #8.

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

Il merge in `main` è bloccato dal gate audit, non dal semplice stato della
CI M5. La PR #23 richiede inoltre l'adattamento al lifecycle `BundleMount`
della linea audit. Compilazione e test possono proseguire su branch dedicate;
non certificano automaticamente un candidato ottenuto integrando due linee.

## Prossimi passi

1. completare i gate del candidato audit dopo #25, discovery #26 e port
   documentale #28; adattare il lifecycle #23 a C-04 in produzione;
2. chiudere il percorso prodotto M5 delle issue #8 e #10;
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
