# Stato del progetto

> **Stato aggiornato per `main@416282569bb78798cfd271480f99140d6307bf5c`, 19 settembre 2026.**

## Baseline corrente

La linea audit è integrata in `main` dalla PR #53. G14 è completo 56/56 e
G15/GO è registrato. La PR #59 ha poi completato preview/revert e guida autore
dei temi senza cambiare il contratto pubblico.

Le issue #7, #8, #10, #12, #13 e #17 sono chiuse con matrici riferite a codice,
test, documentazione e CI. #11 conserva soltanto la chiusura tecnica delle
superfici condivise: guardie di completezza, scena Grid dedicata e rimozione del
TODO temporaneo. #6 resta aperta perché il criterio di stabilizzazione heap è
posseduto da #56 e non è sostituito da una metrica review-only.

## Release corrente

Fub non ha ancora pubblicato un tag. Workspace e shell dichiarano `0.1.0`; il
contratto plugin corrente include Grid v1 in ABI/WIT e mirror TypeScript.

Sono presenti:

- vault local-first, revisioni, bozze, cestino e versioning;
- ricerca, link, Graph View, editor e anteprima;
- `DocumentSession` condivisa e `DocumentSurfaceRegistry`;
- formato `.fubsheet`, `GridEngine` e protocollo Grid a finestre/patch;
- temi installabili con contratto `theme-1`;
- runtime WASM, capability, UI non fidata e percorso prodotto installato.

## Superfici condivise

La shell risolve ogni documento tramite `DocumentSurfaceRegistry`. Una
famiglia registra i profili che può montare; binding di formato/specie e
override non possono inventare profili. Un override non servito prosegue lungo
la catena di fallback.

Grid v1 usa lo stesso contratto per provider nativo e WASM. Il guard
`public_surface_family_delivery` rende incompleta una nuova famiglia ABI finché
non esistono insieme shell, fallback, mirror TypeScript, provider nativo e
percorso WASM. La scena visuale `grid-sheet` esercita il cliente `.fubsheet`
reale attraverso la shell e il fake IPC tipizzato.

Le invarianti permanenti vivono in
[Frontend e IPC](../architecture/frontend-and-ipc.md),
[Editor e anteprima](../product/editor-and-preview.md),
[Runtime dei plugin](../architecture/plugin-runtime.md) e
[ADR 0201](../decisions/0201-superfici-strutturate-a-finestre.md).

## Runtime WASM

M5 è consegnata. Il percorso prodotto distingue installazione, dati persistenti,
consenso, scelta `enabled` e istanza montata. `CommandProvider`,
`FormatProvider`, `ViewProvider` e `GridProvider` attraversano i percorsi
esercitati nativo/WASM.

I limiti non promessi restano espliciti:

- #57 possiede `WASM-002`: `IndexProvider` e `EventHandler` inbound;
- #58 possiede `WASM-003`: quote assolute CPU/RAM di processo oltre i limiti
  per-store e le deadline cooperative.

La pagina [M5](m5-wasm-runtime.md) è una retrospettiva della milestone, non un
piano ancora aperto.

## Graph View

La modularizzazione e il teardown strutturale sono consegnati; #12 è chiusa.
I benchmark 2k/10k restano riproducibili e il delta di listener, observer,
timer e `requestAnimationFrame` dopo destroy è un controllo hard.

#6 resta invece aperta finché #56 non introduce e dimostra un criterio hard
ripetibile per la stabilizzazione della memoria in una sessione prolungata.

## Lavoro residuo

- #11: completare la certificazione finale delle guardie e della scena Grid;
- #56 → #6: criterio hard di stabilizzazione heap e più esecuzioni sullo stesso
  SHA;
- #5: ripristino atomico degli snapshot del database;
- #9: classificazione rispetto al primo release candidate;
- #57 e #58: follow-up WASM esplicitamente differiti.

Non esiste un blocco audit globale: i residui appartengono alle rispettive
issue e non retrocedono le capacità già integrate.

## Fonti

- [Roadmap](roadmap.md)
- [M5 — retrospettiva](m5-wasm-runtime.md)
- [Changelog](../../CHANGELOG.md)
- [Baseline post-PR #53 — #54](https://github.com/Fubeo/Fub/issues/54)
- [Issue aperte](https://github.com/Fubeo/Fub/issues)
