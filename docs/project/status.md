# Stato del progetto

> **Stato aggiornato per:** `main` al commit
> `cf50f60fd17e53d11e74ff2e7af96d572f69b10e`, 9 settembre 2026.

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
nativo di discovery e lifecycle. È lavoro separato da questo stato di `main`:
non viene contato come consegnato prima di revisione, verifiche e merge.

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

Nessun blocco globale impedisce di compilare o testare il workspace. Le aree
future restano fuori dal prodotto finché non hanno contratto, implementazione e
prova.

## Prossimi passi

1. chiudere il percorso M5 dimostrato dalle issue #8 e #10;
2. completare ripristino atomico e backup/restore #5/#7;
3. separare la Graph View soltanto con benchmark e test #6/#12;
4. proseguire dalla fase 5 del
   [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md),
   tracciato in #11;
5. chiudere le decisioni sui temi #13;
6. preparare la prima release dopo il ciclo completo di compatibilità,
   supply chain e installazione.

## Fonti

- [Roadmap](roadmap.md)
- [M5](m5-wasm-runtime.md)
- [TODO sulle superfici di editing](todo-superfici-di-editing-condivise.md)
- [Changelog](../../CHANGELOG.md)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
